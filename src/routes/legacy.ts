import express from 'express';
import { AspectRatio, ASPECT_RATIOS } from '../types';
import generateRouter from './generate';

/**
 * Haelt die alten Pfade `/api/openai/generate-images` und
 * `/api/bfl/generate-images` am Leben, damit vorhandene Skripte nicht mit dem
 * Umbau brechen. Sie schreiben den Rumpf um und reichen an `/api/generate`
 * weiter — neue Aufrufe sollten direkt dorthin gehen.
 */
const legacy: express.Router = express.Router();

/** Was frueher „Size" hiess, uebersetzt in ein Seitenverhaeltnis. */
const LEGACY_SIZES: Record<string, AspectRatio> = {
    SMALL: '1:1',
    MEDIUM: '1:1',
    LARGE: '1:1',
    LARGE_VERTICAL: '9:16',
    LARGE_HORIZONTAL: '16:9',
};

/** Die abgeschalteten DALL-E-Namen zeigen auf den heutigen Nachfolger. */
const LEGACY_MODELS: Record<string, string> = {
    DALL_E_TWO: 'gpt-image-1-mini',
    DALL_E_THREE: 'gpt-image-2',
};

const toRatio = (value: unknown): AspectRatio | undefined => {
    if (typeof value !== 'string') return undefined;
    if ((ASPECT_RATIOS as readonly string[]).includes(value)) return value as AspectRatio;
    return LEGACY_SIZES[value.toUpperCase()];
};

/**
 * Die eigentliche Übersetzung, ohne Express — damit sie sich prüfen lässt.
 * Undefinierte Felder fallen heraus, statt als `undefined` an die Validierung
 * zu gehen, die sie dann als gesetzt behandelt.
 */
export const toModernBody = (body: Record<string, unknown>): Record<string, unknown> => {
    const model = typeof body.languageModel === 'string' ? body.languageModel : undefined;
    const quality = typeof body.quality === 'string' ? body.quality.toLowerCase() : undefined;

    const uebersetzt: Record<string, unknown> = {
        prompt: body.description ?? body.prompt,
        model: (model && LEGACY_MODELS[model]) ?? model,
        ratio: toRatio(body.ratio) ?? toRatio(body.size) ?? '1:1',
        // `HD` und `STANDARD` gibt es nicht mehr; beides auf die neue Skala legen.
        quality: quality === 'hd' ? 'high' : quality === 'standard' ? 'medium' : quality,
        outputFormat: body.outputFormat,
        amount: body.amount,
        revisePrompt: body.revisePrompt,
        seed: body.seed,
        inputImages: body.inputImages,
    };

    for (const [schluessel, wert] of Object.entries(uebersetzt)) {
        if (wert === undefined) delete uebersetzt[schluessel];
    }
    return uebersetzt;
};

const rewrite: express.RequestHandler = (req, res, next) => {
    req.body = toModernBody(req.body ?? {});
    // Direkt an den neuen Router weiterreichen, statt intern erneut zu routen.
    req.url = '/generate';
    generateRouter(req, res, next);
};

legacy.post('/openai/generate-images', rewrite);
legacy.post('/bfl/generate-images', rewrite);

export default legacy;
