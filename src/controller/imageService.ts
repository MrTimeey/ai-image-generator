import { v4 as uuidv4 } from 'uuid';
import {
    AspectRatio,
    GeneratedImage,
    GenerationResult,
    OutputFormat,
    ProviderImage,
    Quality,
} from '../types';
import { ModelDefinition } from './modelRegistry';
import { clampQuality, resolveSize } from '../common/aspectRatio';
import { currentTimestamp } from '../common/timeUtils';
import {
    fetchImageBytes,
    getFileName,
    imagePath,
    persistImage,
    saveReferenceImage,
    writeImage,
} from '../common/fileUtils';
import sharp from 'sharp';
import { createThumbnail } from '../routes/thumbnails';
import { createBigThumbnail } from '../routes/files';
import * as openAi from './openAiController';
import * as bfl from './bflController';
import { describeError, ProviderError } from '../common/providerError';
import { InputImage, parseInputImage } from '../common/inputImage';

export type GenerationRequest = {
    prompt: string;
    model: ModelDefinition;
    ratio: AspectRatio;
    quality?: Quality;
    outputFormat: OutputFormat;
    amount: number;
    revisePrompt: boolean;
    seed?: number;
    /** Referenzbilder als base64, roh oder als `data:`-URL. */
    inputImages?: string[];
};

/**
 * Der eine Weg vom Prompt zum gespeicherten Bild. Beide Anbieter liefern hier
 * dasselbe `ProviderImage` ab; alles danach — Bytes holen, ablegen,
 * Vorschaubilder, `data.json` — ist gemeinsam.
 */
export const generate = async (request: GenerationRequest): Promise<GenerationResult> => {
    const { model, prompt, ratio, outputFormat, amount, revisePrompt, seed } = request;
    const quality = clampQuality(model, request.quality);
    const size = resolveSize(model, ratio, quality);

    const raw = request.inputImages ?? [];
    if (raw.length > 0 && model.maxInputImages === 0) {
        throw new ProviderError(
            400,
            'input_images_unsupported',
            `„${model.label}" wertet keine Referenzbilder aus.`
        );
    }
    if (raw.length > model.maxInputImages) {
        throw new ProviderError(
            400,
            'too_many_input_images',
            `„${model.label}" nimmt höchstens ${model.maxInputImages} Referenzbild(er), übergeben wurden ${raw.length}.`
        );
    }
    const inputImages: InputImage[] = raw.map(parseInputImage);

    /**
     * Die Referenzbilder einmal ablegen — alle Bilder dieses Laufs teilen sie
     * sich. In der Detailansicht ist sonst nicht nachvollziehbar, worauf sich
     * ein Prompt wie „mach den Hintergrund tiefblau" ueberhaupt bezog.
     */
    const referenceNames: string[] = [];
    for (const image of inputImages) {
        try {
            referenceNames.push(await saveReferenceImage(uuidv4(), image.buffer));
        } catch (error) {
            // Ein nicht ablegbares Referenzbild darf die Generierung nicht
            // verhindern — es ist nur Beiwerk.
            console.warn('Referenzbild nicht ablegbar:', describeError(error));
        }
    }

    let providerImages: ProviderImage[];
    const errors: string[] = [];

    if (model.provider === 'openai') {
        providerImages = await openAi.generateImages(prompt, model, size, quality, outputFormat, amount, inputImages);
    } else {
        const result = await bfl.generateImages(prompt, model, size, outputFormat, amount, revisePrompt, inputImages, seed);
        providerImages = result.images;
        errors.push(...result.errors);
    }

    const createdAt = currentTimestamp();
    const images: GeneratedImage[] = [];

    for (const providerImage of providerImages) {
        const id = uuidv4();
        // BFL liefert `webp` nicht; der Controller faellt dort auf png zurueck.
        const format: OutputFormat =
            model.provider === 'bfl' && outputFormat === 'webp' ? 'png' : outputFormat;
        const fileName = getFileName(id, createdAt, format);
        try {
            writeImage(fileName, await fetchImageBytes(providerImage));
        } catch (error) {
            // Ein einzelnes verlorenes Bild darf die uebrigen nicht mitreissen —
            // die BFL-URLs verfallen nach rund zehn Minuten.
            errors.push(describeError(error));
            continue;
        }
        // Bei `aspect_ratio` bestimmt der Anbieter die Kantenlaengen selbst —
        // `size` ist dort nur eine Schaetzung. Also an der Datei nachmessen,
        // statt in `data.json` und Antwort eine Zahl zu behaupten.
        const measured = await sharp(imagePath(fileName)).metadata();
        const image: GeneratedImage = {
            id,
            fileName,
            width: measured.width ?? size.width,
            height: measured.height ?? size.height,
            revisedPrompt: providerImage.revisedPrompt,
            seed: providerImage.seed,
        };
        persistImage(image, createdAt, model, prompt, ratio, referenceNames);
        await createBigThumbnail(fileName);
        await createThumbnail(fileName);
        images.push(image);
    }

    return {
        createdAt,
        model: model.id,
        provider: model.provider,
        description: prompt,
        width: images[0]?.width ?? size.width,
        height: images[0]?.height ?? size.height,
        images,
        errors,
    };
};
