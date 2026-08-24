import axios, { AxiosError } from 'axios';
import appConfig from '../common/appConfig';
import { OutputFormat, ProviderImage } from '../types';
import { ModelDefinition } from './modelRegistry';
import { ResolvedSize } from '../common/aspectRatio';
import { ProviderError } from '../common/providerError';
import { InputImage } from '../common/inputImage';

const BASE_URL = 'https://api.bfl.ai/v1';

/** Nach dieser Zeit gilt ein Auftrag als verloren. */
const POLL_DEADLINE_MS = 180_000;
const POLL_START_MS = 1_000;
const POLL_FACTOR = 1.5;
const POLL_MAX_MS = 10_000;
const MAX_TRANSIENT_ERRORS = 6;

/**
 * Die Zustaende, die `get_result` kennt. `Failed` — worauf der alte Code
 * wartete — ist **keiner davon**: ein moderierter Auftrag pollte deshalb
 * endlos, der HTTP-Request kehrte nie zurueck und der Spinner drehte ewig.
 */
const TERMINAL_STATUS: Record<string, string> = {
    Error: 'Die Bildgenerierung ist beim Anbieter fehlgeschlagen.',
    'Request Moderated': 'Der Prompt wurde von der Inhaltsprüfung abgelehnt.',
    'Content Moderated': 'Das erzeugte Bild wurde von der Inhaltsprüfung abgelehnt.',
    'Task not found': 'Der Auftrag ist beim Anbieter nicht mehr bekannt.',
};

type BflSubmitResponse = { id?: string; polling_url?: string };
type BflResultResponse = {
    status?: string;
    result?: { sample?: string; prompt?: string; seed?: number };
    details?: unknown;
};

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

const bflHeaders = () => {
    if (!appConfig.bfl.apiKey) {
        throw new ProviderError(503, 'bfl_not_configured', 'Es ist kein BFL-Schlüssel hinterlegt.');
    }
    return {
        accept: 'application/json',
        'x-key': appConfig.bfl.apiKey,
        'Content-Type': 'application/json',
    };
};

/**
 * Baut den Rumpf so, wie der jeweilige Endpunkt ihn wirklich auswertet.
 * Am 24.08.2026 nachgemessen: die FLUX.2-Endpunkte und `flux-pro-1.1` nehmen
 * `aspect_ratio` zwar entgegen, **ignorieren es aber** und liefern ihre
 * Standardgroesse. Nur Kontext und `flux-pro-1.1-ultra` werten es aus.
 */
const buildBody = (
    prompt: string,
    model: ModelDefinition,
    size: ResolvedSize,
    format: OutputFormat,
    revisePrompt: boolean,
    inputImages: InputImage[],
    seed?: number
): Record<string, unknown> => {
    const body: Record<string, unknown> = {
        prompt,
        output_format: format === 'webp' ? 'png' : format,
    };
    if (model.sizeMode === 'aspect_ratio') {
        body.aspect_ratio = size.aspectRatio;
    } else {
        body.width = size.width;
        body.height = size.height;
    }
    if (model.supportsRevisePrompt) {
        body.prompt_upsampling = revisePrompt;
    }
    if (model.supportsSeed && seed !== undefined) {
        body.seed = seed;
    }
    /**
     * Das erste Bild heisst `input_image`, jedes weitere `input_image_2`,
     * `input_image_3`, … — FLUX.2 rechnet sie einzeln ab (`input_mp` in der
     * Antwort waechst pro Bild). Kontext wertet nur das erste aus.
     */
    inputImages.slice(0, model.maxInputImages).forEach((image, index) => {
        body[index === 0 ? 'input_image' : `input_image_${index + 1}`] = image.base64;
    });
    return body;
};

const submit = async (model: ModelDefinition, body: Record<string, unknown>): Promise<string> => {
    try {
        const response = await axios.post<BflSubmitResponse>(`${BASE_URL}/${model.endpoint}`, body, {
            headers: bflHeaders(),
            timeout: 30_000,
        });
        const pollingUrl = response.data?.polling_url;
        if (!pollingUrl) {
            // Frueher lief `pollForResult(undefined)` weiter und warf erst tief
            // in axios — die Ursache stand dann nirgends.
            throw new ProviderError(502, 'bfl_no_polling_url', 'BFL hat keine Polling-URL geliefert.');
        }
        return pollingUrl;
    } catch (error) {
        throw toProviderError(error, 'bfl_submit_failed');
    }
};

export const pollForResult = async (pollUrl: string): Promise<ProviderImage> => {
    const deadline = Date.now() + POLL_DEADLINE_MS;
    let wait = POLL_START_MS;
    let transientErrors = 0;

    while (Date.now() < deadline) {
        try {
            const response = await axios.get<BflResultResponse>(pollUrl, {
                timeout: 15_000,
                headers: { accept: 'application/json', 'x-key': appConfig.bfl.apiKey },
            });
            const status = response.data?.status ?? '';

            if (status === 'Ready') {
                const sample = response.data?.result?.sample;
                if (!sample) {
                    throw new ProviderError(502, 'bfl_empty_result', 'BFL meldete „Ready" ohne Bild.');
                }
                return {
                    url: sample,
                    revisedPrompt: response.data?.result?.prompt,
                    seed: response.data?.result?.seed,
                };
            }

            const terminal = TERMINAL_STATUS[status];
            if (terminal) {
                const detail = response.data?.details ? ` (${JSON.stringify(response.data.details)})` : '';
                throw new ProviderError(422, `bfl_${status.toLowerCase().replace(/\s+/g, '_')}`, terminal + detail);
            }

            // Alles andere ist `Pending` oder ein neuer Zustand — weiter warten.
            transientErrors = 0;
        } catch (error) {
            if (error instanceof ProviderError) throw error;
            const axiosError = error as AxiosError;
            const retryable =
                isRetryableNetworkError(axiosError) || isRetryableHttpStatus(axiosError.response?.status);
            if (!retryable || ++transientErrors > MAX_TRANSIENT_ERRORS) {
                throw toProviderError(error, 'bfl_poll_failed');
            }
        }

        await sleep(wait);
        wait = Math.min(POLL_MAX_MS, Math.round(wait * POLL_FACTOR));
    }

    throw new ProviderError(504, 'bfl_timeout', `Der Anbieter hat innerhalb von ${POLL_DEADLINE_MS / 1000} s kein Bild geliefert.`);
};

export const generateImages = async (
    prompt: string,
    model: ModelDefinition,
    size: ResolvedSize,
    format: OutputFormat,
    amount: number,
    revisePrompt: boolean,
    inputImages: InputImage[],
    seed?: number
): Promise<{ images: ProviderImage[]; errors: string[] }> => {
    // Bei mehreren Bildern jeweils einen eigenen Seed, sonst liefert BFL
    // viermal dasselbe Bild.
    const body = (index: number) =>
        buildBody(prompt, model, size, format, revisePrompt, inputImages, seed === undefined ? undefined : seed + index);

    const settled = await Promise.allSettled(
        Array.from({ length: amount }, (_, index) =>
            submit(model, body(index)).then(url => pollForResult(url))
        )
    );

    const images: ProviderImage[] = [];
    const errors: string[] = [];
    for (const result of settled) {
        if (result.status === 'fulfilled') {
            images.push(result.value);
        } else {
            // Frueher wurden abgelehnte Promises stillschweigend verworfen.
            const reason = result.reason;
            errors.push(reason instanceof Error ? reason.message : String(reason));
        }
    }

    if (images.length === 0) {
        const first = settled.find(r => r.status === 'rejected') as PromiseRejectedResult | undefined;
        if (first?.reason instanceof ProviderError) throw first.reason;
        throw new ProviderError(502, 'bfl_error', errors[0] ?? 'Die Bildgenerierung ist fehlgeschlagen.');
    }
    return { images, errors };
};

const toProviderError = (error: unknown, fallbackCode: string): ProviderError => {
    if (error instanceof ProviderError) return error;
    const axiosError = error as AxiosError<{ detail?: unknown }>;
    const status = axiosError.response?.status ?? 502;
    const detail = axiosError.response?.data?.detail;
    const message = detail ? JSON.stringify(detail) : axiosError.message;
    return new ProviderError(status, fallbackCode, message);
};

const isRetryableNetworkError = (error: AxiosError): boolean =>
    ['EAI_AGAIN', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ECONNABORTED'].includes(
        String(error?.code ?? '')
    );

const isRetryableHttpStatus = (status?: number): boolean => {
    if (!status) return false;
    return status === 429 || (status >= 500 && status < 600);
};
