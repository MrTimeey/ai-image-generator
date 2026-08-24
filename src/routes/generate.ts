import express from 'express';
import { z } from 'zod';
import { ASPECT_RATIOS, AspectRatio, OUTPUT_FORMATS, QUALITIES } from '../types';
import { availableModels, DEFAULT_MODEL, findModel, MODELS } from '../controller/modelRegistry';
import { generate } from '../controller/imageService';
import { describeError, ProviderError, statusOf } from '../common/providerError';
import { hasProvider } from '../common/appConfig';
import { clampQuality, resolveSize } from '../common/aspectRatio';
import { getCredits } from '../controller/creditsController';

const generateRouter: express.Router = express.Router();

const GenerateSchema = z.object({
    prompt: z.string().min(1, 'prompt darf nicht leer sein'),
    model: z.string().optional().default(DEFAULT_MODEL),
    ratio: z.enum(ASPECT_RATIOS).optional().default('1:1'),
    quality: z.enum(QUALITIES).optional(),
    outputFormat: z.enum(OUTPUT_FORMATS).optional().default('png'),
    amount: z.number().int().min(1).max(4).optional().default(1),
    revisePrompt: z.boolean().optional().default(false),
    seed: z.number().int().optional(),
    /**
     * Referenzbilder als base64 (roh oder `data:image/...;base64,…`). Die
     * Obergrenze steht je Modell in der Registry; hier nur ein Deckel gegen
     * offensichtlichen Unfug.
     */
    inputImages: z.array(z.string().min(1)).max(8).optional(),
});

/**
 * Die Registry, wie Oberflaeche und Skripte sie sehen. Bewusst dieselbe
 * Quelle wie der Generierungsweg — eine zweite, gepflegte Modellliste waere
 * genau die, die veraltet.
 */
generateRouter.get('/models', (_req, res) => {
    const models = availableModels(hasProvider).map(model => ({
        id: model.id,
        provider: model.provider,
        label: model.label,
        hint: model.hint,
        cost: model.cost,
        ratios: model.ratios,
        qualities: model.qualities,
        formats: model.formats,
        maxAmount: model.maxAmount,
        supportsRevisePrompt: model.supportsRevisePrompt,
        supportsSeed: model.supportsSeed,
        maxInputImages: model.maxInputImages,
        /**
         * Nur wo die App die Kantenlaengen selbst bestimmt. Bei
         * `aspect_ratio` waehlt der Anbieter sie — eine Zahl hier waere
         * geraten, und die UI wuerde etwas anderes anzeigen als herauskommt.
         */
        sizes: model.sizeMode === 'aspect_ratio'
            ? null
            : Object.fromEntries(
                  model.ratios.map(ratio => {
                      const size = resolveSize(model, ratio, clampQuality(model, undefined));
                      return [ratio, `${size.width}x${size.height}`];
                  })
              ),
    }));
    res.send({ defaultModel: findModel(DEFAULT_MODEL) && hasProvider.bfl ? DEFAULT_MODEL : models[0]?.id, models });
});

generateRouter.get('/credits', async (req, res) => {
    res.send({ providers: await getCredits(req.query.refresh === '1') });
});

generateRouter.post('/generate', async (req, res) => {
    const parsed = GenerateSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).send({
            error: 'invalid_request',
            message: parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; '),
        });
    }
    const { prompt, ratio, quality, outputFormat, amount, revisePrompt, seed, inputImages } = parsed.data;

    const model = findModel(parsed.data.model);
    if (!model) {
        return res.status(400).send({
            error: 'unknown_model',
            message: `Unbekanntes Modell „${parsed.data.model}". Verfügbar: ${MODELS.map(m => m.id).join(', ')}`,
        });
    }
    if (!hasProvider[model.provider]) {
        return res.status(503).send({
            error: 'provider_not_configured',
            message: `Fuer „${model.label}" ist kein ${model.provider.toUpperCase()}-Schlüssel hinterlegt.`,
        });
    }
    if (!model.ratios.includes(ratio as AspectRatio)) {
        return res.status(400).send({
            error: 'unsupported_ratio',
            message: `„${model.label}" kann ${ratio} nicht. Möglich: ${model.ratios.join(', ')}`,
        });
    }
    if (!model.formats.includes(outputFormat)) {
        return res.status(400).send({
            error: 'unsupported_format',
            message: `„${model.label}" kann ${outputFormat} nicht. Möglich: ${model.formats.join(', ')}`,
        });
    }
    const requestedAmount = Math.min(amount, model.maxAmount);

    try {
        const result = await generate({
            prompt,
            model,
            ratio,
            quality,
            outputFormat,
            amount: requestedAmount,
            revisePrompt,
            seed,
            inputImages,
        });
        if (result.images.length === 0) {
            return res.status(502).send({
                error: 'generation_failed',
                message: result.errors[0] ?? 'Es wurde kein Bild erzeugt.',
                errors: result.errors,
            });
        }
        res.status(200).send({
            createdAt: result.createdAt,
            model: result.model,
            provider: result.provider,
            width: result.width,
            height: result.height,
            images: result.images.map(image => ({
                id: image.id,
                fileName: image.fileName,
                width: image.width,
                height: image.height,
                url: `/api/files/download/${image.fileName}`,
                revisedPrompt: image.revisedPrompt,
                seed: image.seed,
            })),
            errors: result.errors,
        });
    } catch (error) {
        const status = statusOf(error);
        console.error('Bildgenerierung fehlgeschlagen:', describeError(error));
        res.status(status).send({
            error: error instanceof ProviderError ? error.code : 'generation_failed',
            message: describeError(error),
        });
    }
});

export default generateRouter;
