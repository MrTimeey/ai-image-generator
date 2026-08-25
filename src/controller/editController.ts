import axios from 'axios';
import sharp from 'sharp';
import OpenAI, { toFile } from 'openai';
import appConfig from '../common/appConfig';
import { ProviderImage } from '../types';
import { InputImage } from '../common/inputImage';
import { ProviderError } from '../common/providerError';
import { pollForResult } from './bflController';
import { openAiCost } from './modelRegistry';

/**
 * Bildbearbeitung mit Maske. Am 25.08.2026 gegen beide APIs gemessen — die
 * drei Aufgaben verteilen sich **nicht** auf einen Anbieter:
 *
 * | Aufgabe   | Anbieter | Endpunkt                  | warum                                   |
 * |-----------|----------|---------------------------|-----------------------------------------|
 * | Ersetzen  | BFL      | `/v1/flux-pro-1.0-fill`   | trifft den Prompt sauber im Maskenfeld  |
 * | Entfernen | OpenAI   | `/v1/images/edits`        | BFL malt stattdessen etwas Neues hinein |
 * | Erweitern | BFL      | `/v1/flux-pro-1.0-expand` | OpenAI kann kein Outpainting            |
 *
 * Beim Entfernen war das der entscheidende Unterschied: BFL füllt die Maske
 * mit dem, was es für plausibel hält — bei einem freigestellten Objekt also
 * wieder einem ähnlichen Objekt. Ein leerer Prompt macht es nur schlimmer.
 *
 * **Die Maskenkonventionen sind gegensätzlich.** Unser Format ist BFLs:
 * weiß = ändern, schwarz = erhalten. OpenAI erwartet das Gegenteil als
 * Alphakanal — transparent = ändern. Umgerechnet wird an einer Stelle,
 * `toOpenAiMask`.
 */
const BFL_URL = 'https://api.bfl.ai/v1';

export type EditMode = 'replace' | 'remove' | 'expand';

export type EditRequest = {
    mode: EditMode;
    image: InputImage;
    /** Für `replace` und `remove`; bei `expand` nicht gesetzt. */
    mask?: InputImage;
    prompt?: string;
    /** Nur für `expand`: Pixel je Kante. */
    expand?: { top: number; bottom: number; left: number; right: number };
};

/** Was beim Entfernen an den Anbieter geht, wenn der Nutzer nichts sagt. */
const REMOVE_PROMPT =
    'Remove the masked object completely and fill the area with the surrounding background. ' +
    'Do not add any new object, person, text or pattern.';

const bflHeaders = () => {
    if (!appConfig.bfl.apiKey) {
        throw new ProviderError(503, 'bfl_not_configured', 'Es ist kein BFL-Schlüssel hinterlegt.');
    }
    return { accept: 'application/json', 'x-key': appConfig.bfl.apiKey, 'Content-Type': 'application/json' };
};

const submitBfl = async (endpoint: string, body: Record<string, unknown>): Promise<ProviderImage> => {
    try {
        const response = await axios.post<{ polling_url?: string; cost?: number | null }>(
            `${BFL_URL}/${endpoint}`,
            body,
            { headers: bflHeaders(), timeout: 30_000 }
        );
        const pollingUrl = response.data?.polling_url;
        if (!pollingUrl) {
            throw new ProviderError(502, 'bfl_no_polling_url', 'BFL hat keine Polling-URL geliefert.');
        }
        const image = await pollForResult(pollingUrl);
        const cost = typeof response.data?.cost === 'number' ? response.data.cost : undefined;
        return cost === undefined ? image : { ...image, cost: { amount: cost, unit: 'credits' } };
    } catch (error) {
        if (error instanceof ProviderError) throw error;
        const axiosError = error as { response?: { status?: number; data?: { detail?: unknown } }; message?: string };
        const detail = axiosError.response?.data?.detail;
        throw new ProviderError(
            axiosError.response?.status ?? 502,
            'bfl_edit_failed',
            detail ? JSON.stringify(detail) : axiosError.message ?? 'Unbekannter Fehler'
        );
    }
};

/**
 * Unsere Schwarz-Weiß-Maske in OpenAIs Alphaformat: wo wir weiß haben, wird
 * das Bild durchsichtig — dort bearbeitet OpenAI. Die Maske muss dieselbe
 * Größe haben wie das Bild, sonst lehnt die API ab.
 */
const toOpenAiMask = async (mask: Buffer, breite: number, hoehe: number): Promise<Buffer> => {
    const grau = await sharp(mask).resize(breite, hoehe, { fit: 'fill' }).greyscale().raw().toBuffer();
    const rgba = Buffer.alloc(breite * hoehe * 4);
    for (let i = 0; i < grau.length; i++) {
        // Weiß (hell) → Alpha 0 → OpenAI ändert dort.
        rgba[i * 4 + 3] = 255 - grau[i];
    }
    return sharp(rgba, { raw: { width: breite, height: hoehe, channels: 4 } }).png().toBuffer();
};

const openAiClient = (): OpenAI => {
    if (!appConfig.openai.apiKey) {
        throw new ProviderError(503, 'openai_not_configured', 'Es ist kein OpenAI-Schlüssel hinterlegt.');
    }
    return new OpenAI({
        apiKey: appConfig.openai.apiKey,
        ...(appConfig.openai.organization ? { organization: appConfig.openai.organization } : {}),
    });
};

const removeWithOpenAi = async (request: EditRequest): Promise<ProviderImage> => {
    if (!request.mask) {
        throw new ProviderError(400, 'mask_required', 'Zum Entfernen wird eine Maske gebraucht.');
    }
    const meta = await sharp(request.image.buffer).metadata();
    const breite = meta.width ?? 1024;
    const hoehe = meta.height ?? 1024;

    try {
        const response = await openAiClient().images.edit({
            model: 'gpt-image-2',
            prompt: request.prompt?.trim() || REMOVE_PROMPT,
            image: [await toFile(request.image.buffer, 'bild.png', { type: 'image/png' })],
            mask: await toFile(await toOpenAiMask(request.mask.buffer, breite, hoehe), 'maske.png', {
                type: 'image/png',
            }),
            // Kanten müssen Vielfache von 16 sein; `auto` überlässt es OpenAI.
            size: 'auto',
            quality: 'high',
        });
        const b64 = response.data?.[0]?.b64_json;
        if (!b64) {
            throw new ProviderError(502, 'openai_empty_response', 'OpenAI hat kein Bild zurückgegeben.');
        }

        /**
         * **Auf die Ausgangsgröße zurück.** OpenAI wählt bei `size: 'auto'`
         * eine eigene Auflösung — aus 512×290 wurden 1667×943. Wer ein Detail
         * entfernt, erwartet aber dasselbe Bild, nicht ein anders großes.
         */
        const bearbeitet = Buffer.from(b64, 'base64');
        const angepasst = await sharp(bearbeitet).resize(breite, hoehe, { fit: 'fill' }).png().toBuffer();

        const usage = response.usage;
        const kosten = usage
            ? openAiCost('gpt-image-2', {
                  textInput: usage.input_tokens_details?.text_tokens ?? usage.input_tokens ?? 0,
                  imageInput: usage.input_tokens_details?.image_tokens ?? 0,
                  imageOutput: usage.output_tokens_details?.image_tokens ?? usage.output_tokens ?? 0,
              })
            : null;

        return {
            buffer: angepasst,
            ...(kosten !== null ? { cost: { amount: kosten, unit: 'usd' as const } } : {}),
        };
    } catch (error) {
        if (error instanceof ProviderError) throw error;
        if (error instanceof OpenAI.APIError) {
            throw new ProviderError(error.status ?? 502, String(error.code ?? 'openai_error'), error.message);
        }
        throw new ProviderError(502, 'openai_error', error instanceof Error ? error.message : String(error));
    }
};

export const editImage = async (request: EditRequest): Promise<ProviderImage> => {
    if (request.mode === 'remove') return removeWithOpenAi(request);

    if (request.mode === 'replace') {
        if (!request.mask) {
            throw new ProviderError(400, 'mask_required', 'Zum Ersetzen wird eine Maske gebraucht.');
        }
        if (!request.prompt?.trim()) {
            throw new ProviderError(400, 'prompt_required', 'Zum Ersetzen wird beschrieben, was dorthin soll.');
        }
        return submitBfl('flux-pro-1.0-fill', {
            image: request.image.base64,
            mask: request.mask.base64,
            prompt: request.prompt.trim(),
            output_format: 'png',
        });
    }

    const kanten = request.expand ?? { top: 0, bottom: 0, left: 0, right: 0 };
    if (Object.values(kanten).every(wert => wert === 0)) {
        throw new ProviderError(400, 'no_expansion', 'Zum Erweitern muss mindestens eine Kante größer als 0 sein.');
    }
    return submitBfl('flux-pro-1.0-expand', {
        image: request.image.base64,
        ...kanten,
        ...(request.prompt?.trim() ? { prompt: request.prompt.trim() } : {}),
        output_format: 'png',
    });
};
