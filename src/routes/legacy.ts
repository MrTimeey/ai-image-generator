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

const rewrite: express.RequestHandler = (req, res, next) => {
    const body = req.body ?? {};
    const model = typeof body.languageModel === 'string' ? body.languageModel : undefined;
    req.body = {
        prompt: body.description ?? body.prompt,
        model: (model && LEGACY_MODELS[model]) ?? model,
        ratio: toRatio(body.ratio) ?? toRatio(body.size) ?? '1:1',
        quality: typeof body.quality === 'string' ? body.quality.toLowerCase() : undefined,
        outputFormat: body.outputFormat,
        amount: body.amount,
        revisePrompt: body.revisePrompt,
        seed: body.seed,
    };
    // `HD` und `STANDARD` gibt es nicht mehr; beides auf die neue Skala legen.
    if (req.body.quality === 'hd') req.body.quality = 'high';
    if (req.body.quality === 'standard') req.body.quality = 'medium';
    if (req.body.quality === undefined) delete req.body.quality;
    if (req.body.outputFormat === undefined) delete req.body.outputFormat;
    if (req.body.amount === undefined) delete req.body.amount;
    if (req.body.revisePrompt === undefined) delete req.body.revisePrompt;
    if (req.body.seed === undefined) delete req.body.seed;
    if (req.body.model === undefined) delete req.body.model;
    // Direkt an den neuen Router weiterreichen, statt intern erneut zu routen.
    req.url = '/generate';
    generateRouter(req, res, next);
};

legacy.post('/openai/generate-images', rewrite);
legacy.post('/bfl/generate-images', rewrite);

export default legacy;
