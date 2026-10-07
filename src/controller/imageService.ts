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
import { clampQuality, nearestRatio, resolveSize } from '../common/aspectRatio';
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
import { LayoutRow } from '../common/layout';
import fs from 'fs';

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
    /**
     * Ein schon erzeugtes Bild als erstes Referenzbild (`ref_image_0`), per
     * Dateiname. Fuer Bearbeitungen mit FLUX 3: das Original kommt in voller
     * Groesse vom Server, statt im Browser verkleinert hochgeladen zu werden
     * — sonst waere das Ergebnis kleiner als das Original, und „ausserhalb
     * der Boxen bleibt alles gleich" stimmte nicht mehr.
     */
    sourceImage?: string;
    /** Nur FLUX 3: Bounding Boxes, siehe `common/layout.ts`. */
    layout?: LayoutRow[];
    /** Nur FLUX 3: Websuche vor dem Generieren. Standard aus. */
    grounding?: boolean;
};

/** Obergrenze von FLUX 3 fuer ein Referenzbild. */
const MAX_SOURCE_PIXELS = 16_000_000;
/** Darueber wird das Ausgangsbild als JPEG neu kodiert, damit der Request schlank bleibt. */
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;

/**
 * Laedt ein abgelegtes Bild als Referenz. Groesser als 16 MP nimmt FLUX 3
 * nicht (400), und ein 4K-PNG von 20 MB waere als base64 im JSON unnoetig
 * schwer — dann lieber ein JPEG in hoher Qualitaet.
 */
const loadSourceImage = async (fileName: string): Promise<InputImage> => {
    const pfad = imagePath(fileName);
    if (!fs.existsSync(pfad)) {
        throw new ProviderError(404, 'source_image_not_found', `Das Ausgangsbild „${fileName}" gibt es nicht.`);
    }
    let buffer: Buffer = fs.readFileSync(pfad);
    const meta = await sharp(buffer).metadata();
    const pixel = (meta.width ?? 0) * (meta.height ?? 0);
    let mimeType = meta.format === 'jpeg' ? 'image/jpeg' : `image/${meta.format ?? 'png'}`;
    if (pixel > MAX_SOURCE_PIXELS || buffer.length > MAX_SOURCE_BYTES) {
        const skala = Math.min(1, Math.sqrt(MAX_SOURCE_PIXELS / Math.max(pixel, 1)));
        buffer = await sharp(buffer)
            .resize(Math.floor((meta.width ?? 0) * skala), Math.floor((meta.height ?? 0) * skala))
            .jpeg({ quality: 92 })
            .toBuffer();
        mimeType = 'image/jpeg';
    }
    return { base64: buffer.toString('base64'), buffer, mimeType };
};

/**
 * FLUX 3 kennt kein `output_format` und liefert, was es will. Dann hier ins
 * bestellte Format umrechnen, statt die Dateiendung luegen zu lassen.
 */
const inFormat = async (bytes: Buffer, format: OutputFormat): Promise<Buffer> => {
    const meta = await sharp(bytes).metadata();
    if (meta.format === format) return bytes;
    const bild = sharp(bytes);
    if (format === 'jpeg') return bild.jpeg({ quality: 95 }).toBuffer();
    if (format === 'webp') return bild.webp({ quality: 95 }).toBuffer();
    return bild.png().toBuffer();
};

/**
 * Der eine Weg vom Prompt zum gespeicherten Bild. Beide Anbieter liefern hier
 * dasselbe `ProviderImage` ab; alles danach — Bytes holen, ablegen,
 * Vorschaubilder, `data.json` — ist gemeinsam.
 */
export const generate = async (request: GenerationRequest): Promise<GenerationResult> => {
    const { model, prompt, ratio, outputFormat, amount, revisePrompt, seed, layout, grounding, sourceImage } = request;
    const quality = clampQuality(model, request.quality);
    const size = resolveSize(model, ratio, quality);

    const raw = request.inputImages ?? [];
    const gesamt = raw.length + (sourceImage ? 1 : 0);
    if (gesamt > 0 && model.maxInputImages === 0) {
        throw new ProviderError(
            400,
            'input_images_unsupported',
            `„${model.label}" wertet keine Referenzbilder aus.`
        );
    }
    if (gesamt > model.maxInputImages) {
        throw new ProviderError(
            400,
            'too_many_input_images',
            `„${model.label}" nimmt höchstens ${model.maxInputImages} Referenzbild(er), übergeben wurden ${gesamt}.`
        );
    }
    const inputImages: InputImage[] = [
        ...(sourceImage ? [await loadSourceImage(sourceImage)] : []),
        ...raw.map(parseInputImage),
    ];

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
    const begonnen = Date.now();

    if (model.provider === 'openai') {
        providerImages = await openAi.generateImages(prompt, model, size, quality, outputFormat, amount, inputImages);
    } else {
        const result = await bfl.generateImages({
            prompt,
            model,
            size,
            format: outputFormat,
            amount,
            revisePrompt,
            inputImages,
            seed,
            layout,
            grounding,
            autoRatio: Boolean(sourceImage) && model.sizeMode === 'aspect_ratio_resolution',
        });
        providerImages = result.images;
        errors.push(...result.errors);
    }

    const dauerMs = Date.now() - begonnen;
    const createdAt = currentTimestamp();
    const images: GeneratedImage[] = [];

    for (const providerImage of providerImages) {
        const id = uuidv4();
        // FLUX.2 und aelter liefern `webp` nicht; der Controller faellt dort
        // auf png zurueck. FLUX 3 wird hinterher umgerechnet.
        const umrechnen = model.acceptsOutputFormat === false;
        const format: OutputFormat =
            model.provider === 'bfl' && outputFormat === 'webp' && !umrechnen ? 'png' : outputFormat;
        const fileName = getFileName(id, createdAt, format);
        try {
            const bytes = await fetchImageBytes(providerImage);
            writeImage(fileName, umrechnen ? await inFormat(bytes, format) : bytes);
        } catch (error) {
            // Ein einzelnes verlorenes Bild darf die uebrigen nicht mitreissen —
            // die BFL-URLs verfallen nach rund zehn Minuten.
            errors.push(describeError(error));
            continue;
        }
        /**
         * Bei `aspect_ratio` bestimmt der Anbieter die Kantenlaengen selbst —
         * `size` ist dort nur eine Schaetzung. Also an der Datei nachmessen,
         * statt in `data.json` und Antwort eine Zahl zu behaupten.
         *
         * Das Messen ist die einzige Pause zwischen „Datei liegt" und „Eintrag
         * existiert". Sie kurz zu halten ist kein Selbstzweck: in dieser Spanne
         * gilt die Datei als verwaist.
         */
        let measured: { width?: number; height?: number } = {};
        try {
            measured = await sharp(imagePath(fileName)).metadata();
        } catch (error) {
            // Ein nicht messbares Bild ist immer noch ein Bild — dann eben mit
            // den angefragten Maßen eintragen.
            errors.push(describeError(error));
        }
        const image: GeneratedImage = {
            id,
            fileName,
            width: measured.width ?? size.width,
            height: measured.height ?? size.height,
            revisedPrompt: providerImage.revisedPrompt,
            seed: providerImage.seed,
            cost: providerImage.cost,
        };
        // Bei `auto` bestimmt das Ausgangsbild den Rahmen — dann das Verhaeltnis
        // eintragen, das wirklich herauskam, nicht das angefragte.
        const eingetragen =
            sourceImage && measured.width && measured.height ? nearestRatio(measured.width, measured.height) : ratio;
        persistImage(image, createdAt, model, prompt, eingetragen, {
            referenceImages: referenceNames,
            quality: model.qualities.length > 0 ? quality : undefined,
            outputFormat: format,
            durationMs: dauerMs,
            layout,
            grounding: model.supportsGrounding ? grounding ?? false : undefined,
            revisePrompt: model.promptRewrite === 'optional' ? revisePrompt : undefined,
            editedFrom: sourceImage,
        });
        // Vorschaubilder sind Beiwerk: das Bild ist bezahlt und liegt bereits,
        // ein Fehler hier darf es nicht mehr in Frage stellen.
        try {
            await createBigThumbnail(fileName);
            await createThumbnail(fileName);
        } catch (error) {
            errors.push(describeError(error));
        }
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
