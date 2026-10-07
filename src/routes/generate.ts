import express from 'express';
import { z } from 'zod';
import { ASPECT_RATIOS, AspectRatio, OUTPUT_FORMATS, QUALITIES } from '../types';
import { availableModels, DEFAULT_MODEL, findModel, MODELS } from '../controller/modelRegistry';
import { generate } from '../controller/imageService';
import { describeError, ProviderError, statusOf } from '../common/providerError';
import { hasProvider } from '../common/appConfig';
import { clampQuality, resolveSize } from '../common/aspectRatio';
import { getCredits } from '../controller/creditsController';
import { spendingReport } from '../common/spending';
import { failJob, finishJob, getJob, isValidJobId, startJob } from '../common/jobStore';
import { layoutErrors, layoutWarnings, LayoutRow, parseLayout } from '../common/layout';
import { safeImageName } from '../common/fileUtils';

const generateRouter: express.Router = express.Router();

/**
 * Deckel fuer die Zahl der Referenzbilder: das Maximum ueber alle Modelle.
 * Aus der Registry abgeleitet, weil ein fester Wert hier schon einmal
 * zurueckblieb — GPT Image 2.5 versprach 16, die Pruefung liess nur 8 durch.
 * Das Limit je Modell prueft `imageService`.
 */
export const MAX_INPUT_IMAGES = Math.max(...MODELS.map(model => model.maxInputImages));

export const GenerateSchema = z.object({
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
    inputImages: z.array(z.string().min(1)).max(MAX_INPUT_IMAGES).optional(),
    /**
     * Ein schon erzeugtes Bild (Dateiname) als erstes Referenzbild — fuer
     * Bearbeitungen. Kommt in voller Groesse vom Server statt aus dem Browser.
     */
    sourceImage: z.string().min(1).optional(),
    /**
     * Nur FLUX 3: Bounding Boxes. `prompt` ist dann der Szenen-Prompt, der die
     * Elemente als `<id>` nennt. Geprueft wird in `parseLayout`, weil die
     * Meldungen dort das falsche Feld beim Namen nennen.
     */
    layout: z.array(z.unknown()).optional(),
    /** Nur FLUX 3: Web- und Bildsuche vor dem Generieren. Standard aus. */
    grounding: z.boolean().optional(),
    /**
     * Vom Client vergebene Kennung. Reisst die Verbindung ab — in der PWA
     * passiert das, sobald sie in den Hintergrund geht —, kann er das Ergebnis
     * damit unter `GET /api/jobs/:id` nachholen.
     */
    requestId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),
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
        /** `never` | `optional` | `always` — siehe `PromptRewrite`. */
        promptRewrite: model.promptRewrite,
        /** Fuer Clients von vor `promptRewrite`. */
        supportsRevisePrompt: model.promptRewrite === 'optional',
        supportsLayout: model.supportsLayout ?? false,
        supportsGrounding: model.supportsGrounding ?? false,
        resolutions: model.resolutions ?? null,
        supportsSeed: model.supportsSeed,
        maxInputImages: model.maxInputImages,
        /**
         * Nur wo die App die Kantenlaengen selbst bestimmt. Bei
         * `aspect_ratio` waehlt der Anbieter sie — eine Zahl hier waere
         * geraten, und die UI wuerde etwas anderes anzeigen als herauskommt.
         */
        /**
         * Nach Qualitätsstufe geschachtelt, denn die Stufe bestimmt die
         * Auflösung mit: bei `max` sind es 3840×2160, bei `low` 1328×752.
         * Eine einzelne Tabelle zeigte in der Oberfläche immer die Maße
         * einer Stufe, die gerade nicht gewählt war.
         */
        sizes: model.sizeMode === 'aspect_ratio' || model.sizeMode === 'aspect_ratio_resolution'
            ? null
            : Object.fromEntries(
                  (model.qualities.length > 0 ? model.qualities : [clampQuality(model, undefined)]).map(quality => [
                      quality,
                      Object.fromEntries(
                          model.ratios.map(ratio => {
                              const size = resolveSize(model, ratio, quality);
                              return [ratio, `${size.width}x${size.height}`];
                          })
                      ),
                  ])
              ),
    }));
    res.send({ defaultModel: findModel(DEFAULT_MODEL) && hasProvider.bfl ? DEFAULT_MODEL : models[0]?.id, models });
});

/** Damit die Antwort auf `/generate` und die auf `/jobs/:id` gleich aussehen. */
const asPayload = (result: {
    createdAt: string;
    model: string;
    provider: string;
    width: number;
    height: number;
    images: {
        id: string;
        fileName: string;
        width: number;
        height: number;
        revisedPrompt?: string;
        seed?: number;
        cost?: { amount: number; unit: string };
    }[];
    errors: string[];
    warnings?: string[];
}) => ({
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
        cost: image.cost,
    })),
    errors: result.errors,
    /** Hinweise, die den Lauf nicht verhindert haben — etwa ein Element, das die Szene nicht nennt. */
    warnings: result.warnings ?? [],
});

/**
 * Den Stand eines Auftrags abfragen. Der Client kennt die Kennung, weil er sie
 * selbst vergeben hat — er braucht die Antwort auf `/generate` dafuer nicht.
 */
generateRouter.get('/jobs/:id', (req, res) => {
    if (!isValidJobId(req.params.id)) {
        return res.status(400).send({ error: 'invalid_job_id', message: 'Ungültige Auftragskennung.' });
    }
    const job = getJob(req.params.id);
    if (!job) {
        // Unbekannt heisst hier auch: zu alt, oder der Container wurde neu
        // gestartet. Beides ist fuer den Client dasselbe.
        return res.status(404).send({ status: 'unknown', message: 'Auftrag nicht bekannt.' });
    }
    if (job.status === 'running') {
        return res.send({ status: 'running', startedAt: job.startedAt });
    }
    if (job.status === 'error') {
        return res.send({ status: 'error', error: job.code, message: job.error });
    }
    res.send({ status: 'done', ...asPayload(job.result) });
});

generateRouter.get('/credits', async (req, res) => {
    // Guthaben der Anbieter **und** die eigene Rechnung: was hier tatsächlich
    // ausgegeben wurde, weiß nur dieser Dienst.
    res.send({ providers: await getCredits(req.query.refresh === '1'), spending: spendingReport() });
});

generateRouter.post('/generate', async (req, res) => {
    const parsed = GenerateSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).send({
            error: 'invalid_request',
            message: parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; '),
        });
    }
    const { prompt, ratio, quality, outputFormat, amount, revisePrompt, seed, inputImages, requestId, grounding } =
        parsed.data;

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

    let sourceImage: string | undefined;
    if (parsed.data.sourceImage !== undefined) {
        sourceImage = safeImageName(parsed.data.sourceImage) ?? undefined;
        if (!sourceImage) {
            return res.status(400).send({ error: 'invalid_source_image', message: 'Ungültiger Bildname für sourceImage.' });
        }
    }

    const warnings: string[] = [];
    let layout: LayoutRow[] | undefined;
    if (parsed.data.layout !== undefined) {
        if (!model.supportsLayout) {
            return res.status(400).send({
                error: 'layout_unsupported',
                message: `„${model.label}" kennt keine Bounding Boxes. Möglich mit: ${MODELS.filter(m => m.supportsLayout)
                    .map(m => m.id)
                    .join(', ')}`,
            });
        }
        const gelesen = parseLayout(parsed.data.layout);
        const fehler = gelesen.rows
            ? layoutErrors(gelesen.rows, (inputImages?.length ?? 0) + (sourceImage ? 1 : 0))
            : gelesen.errors;
        if (fehler.length > 0 || !gelesen.rows) {
            return res.status(400).send({ error: 'invalid_layout', message: fehler.join('; ') });
        }
        layout = gelesen.rows;
        warnings.push(...layoutWarnings(prompt, layout));
    }
    if (revisePrompt && model.promptRewrite !== 'optional') {
        warnings.push(
            model.promptRewrite === 'always'
                ? `„${model.label}" formuliert den Prompt ohnehin immer aus.`
                : `„${model.label}" formuliert nicht aus — revisePrompt wurde ignoriert.`
        );
    }
    if (grounding && !model.supportsGrounding) {
        warnings.push(`„${model.label}" kennt kein Grounding — grounding wurde ignoriert.`);
    }

    if (requestId) startJob(requestId);

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
            sourceImage,
            layout,
            grounding,
        });
        if (result.images.length === 0) {
            const message = result.errors[0] ?? 'Es wurde kein Bild erzeugt.';
            if (requestId) failJob(requestId, 'generation_failed', message);
            return res.status(502).send({ error: 'generation_failed', message, errors: result.errors });
        }
        // **Vor dem Senden ablegen.** Ist die Verbindung schon tot, laeuft
        // `res.send` ins Leere — der Auftrag muss trotzdem abholbar sein.
        const mitHinweisen = { ...result, warnings };
        if (requestId) finishJob(requestId, mitHinweisen);
        res.status(200).send(asPayload(mitHinweisen));
    } catch (error) {
        const status = statusOf(error);
        const message = describeError(error);
        const code = error instanceof ProviderError ? error.code : 'generation_failed';
        console.error('Bildgenerierung fehlgeschlagen:', message);
        if (requestId) failJob(requestId, code, message);
        res.status(status).send({ error: code, message });
    }
});

export default generateRouter;
