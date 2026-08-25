import express from 'express';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import sharp from 'sharp';
import { editImage, EditMode } from '../controller/editController';
import { parseInputImage } from '../common/inputImage';
import {
    fetchImageBytes,
    getFileName,
    imagePath,
    persistImage,
    safeImageName,
    saveReferenceImage,
    writeImage,
} from '../common/fileUtils';
import { currentTimestamp } from '../common/timeUtils';
import { createBigThumbnail } from './files';
import { createThumbnail } from './thumbnails';
import { describeError, ProviderError, statusOf } from '../common/providerError';
import { failJob, finishJob, startJob } from '../common/jobStore';
import { findModel } from '../controller/modelRegistry';
import { GeneratedImage } from '../types';

const edit: express.Router = express.Router();

const EditSchema = z.object({
    /** Das zu bearbeitende Bild aus dem Bestand. */
    fileName: z.string().min(1),
    mode: z.enum(['replace', 'remove', 'expand']),
    /** Base64-PNG, weiß = ändern. Bei `expand` nicht nötig. */
    mask: z.string().min(1).optional(),
    prompt: z.string().max(4000).optional(),
    expand: z
        .object({
            top: z.number().int().min(0).max(2048).default(0),
            bottom: z.number().int().min(0).max(2048).default(0),
            left: z.number().int().min(0).max(2048).default(0),
            right: z.number().int().min(0).max(2048).default(0),
        })
        .optional(),
    requestId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),
});

/** Welches „Modell" in den Metadaten steht — die Modi sind keine Registry-Einträge. */
const MODELL_JE_MODUS: Record<EditMode, string> = {
    replace: 'flux-pro-1.0-fill',
    remove: 'gpt-image-2',
    expand: 'flux-pro-1.0-expand',
};

edit.post('/', async (req, res) => {
    const parsed = EditSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).send({
            error: 'invalid_request',
            message: parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; '),
        });
    }
    const { mode, prompt, expand, requestId } = parsed.data;

    const quelle = safeImageName(parsed.data.fileName);
    if (!quelle || !fs.existsSync(imagePath(quelle))) {
        return res.status(404).send({ error: 'not_found', message: 'Das Ausgangsbild gibt es nicht.' });
    }

    if (requestId) startJob(requestId);

    try {
        // Das Ausgangsbild kommt aus dem Bestand, nicht vom Client: so lädt
        // niemand ein Original hoch, das schon auf der Platte liegt.
        const original = parseInputImage(fs.readFileSync(imagePath(quelle)).toString('base64'), 0);
        const maske = parsed.data.mask ? parseInputImage(parsed.data.mask, 1) : undefined;

        const ergebnis = await editImage({ mode, image: original, mask: maske, prompt, expand });

        const createdAt = currentTimestamp();
        const id = uuidv4();
        const fileName = getFileName(id, createdAt, 'png');
        writeImage(fileName, await fetchImageBytes(ergebnis));

        let breite = 0;
        let hoehe = 0;
        try {
            const gemessen = await sharp(imagePath(fileName)).metadata();
            breite = gemessen.width ?? 0;
            hoehe = gemessen.height ?? 0;
        } catch (error) {
            console.warn('Bearbeitetes Bild nicht messbar:', describeError(error));
        }

        // Das Ausgangsbild als Vorlage vermerken — die Herkunftskette bleibt
        // sichtbar, genau wie bei „Als Referenz nutzen".
        const referenzen: string[] = [];
        try {
            referenzen.push(await saveReferenceImage(uuidv4(), original.buffer));
        } catch (error) {
            console.warn('Ausgangsbild nicht als Vorlage ablegbar:', describeError(error));
        }

        const bild: GeneratedImage = {
            id,
            fileName,
            width: breite,
            height: hoehe,
            revisedPrompt: ergebnis.revisedPrompt,
            seed: ergebnis.seed,
            cost: ergebnis.cost,
        };

        const modellId = MODELL_JE_MODUS[mode];
        const beschreibung =
            mode === 'expand'
                ? `Erweitert: ${prompt?.trim() || quelle}`
                : mode === 'remove'
                  ? `Entfernt aus ${quelle}`
                  : prompt?.trim() ?? '';

        persistImage(
            bild,
            createdAt,
            // Für die Ablage genügt ein Registry-Eintrag mit passendem Anbieter;
            // die Bearbeitungsendpunkte stehen dort bewusst nicht als Modelle.
            findModel(modellId) ?? {
                id: modellId,
                provider: mode === 'remove' ? 'openai' : 'bfl',
                label: modellId,
                hint: '',
                endpoint: modellId,
                sizeMode: 'width_height',
                ratios: [],
                qualities: [],
                formats: ['png'],
                maxAmount: 1,
                supportsRevisePrompt: false,
                maxInputImages: 1,
                supportsSeed: false,
                cost: 'medium',
            },
            beschreibung,
            '',
            { referenceImages: referenzen, outputFormat: 'png' }
        );

        try {
            await createBigThumbnail(fileName);
            await createThumbnail(fileName);
        } catch (error) {
            console.warn('Vorschaubild nicht erzeugbar:', describeError(error));
        }

        const antwort = {
            createdAt,
            mode,
            model: modellId,
            width: breite,
            height: hoehe,
            images: [
                {
                    id,
                    fileName,
                    width: breite,
                    height: hoehe,
                    url: `/api/files/download/${fileName}`,
                    cost: ergebnis.cost,
                },
            ],
            errors: [] as string[],
        };
        // Vor dem Senden ablegen: ist die Verbindung tot, muss der Auftrag
        // trotzdem über `/api/jobs/:id` abholbar sein.
        if (requestId) {
            finishJob(requestId, {
                ...antwort,
                provider: mode === 'remove' ? 'openai' : 'bfl',
                description: beschreibung,
                images: [bild],
            });
        }
        res.status(200).send(antwort);
    } catch (error) {
        const code = error instanceof ProviderError ? error.code : 'edit_failed';
        const message = describeError(error);
        console.error('Bearbeitung fehlgeschlagen:', message);
        if (requestId) failJob(requestId, code, message);
        res.status(statusOf(error)).send({ error: code, message });
    }
});

export default edit;
