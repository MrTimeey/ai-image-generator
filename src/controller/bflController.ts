import axios, { AxiosError } from 'axios';
import appConfig from '../common/appConfig';
import { OutputFormat, ProviderImage } from '../types';
import { ModelDefinition } from './modelRegistry';
import { ResolvedSize } from '../common/aspectRatio';
import { ProviderError } from '../common/providerError';
import { InputImage } from '../common/inputImage';
import { composePrompt, LayoutRow } from '../common/layout';

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

type BflSubmitResponse = {
    id?: string;
    polling_url?: string;
    /**
     * Kosten in BFL-Credits, plus die verrechnete Ein- und Ausgabeflaeche in
     * Megapixeln. Kommt **beim Absenden** zurueck, nicht beim Abholen — deshalb
     * muss der Wert bis zum fertigen Bild durchgereicht werden.
     */
    cost?: number | null;
    input_mp?: number | null;
    output_mp?: number | null;
};
type BflResultResponse = {
    status?: string;
    /**
     * Bei Bildern `sample`, `prompt`, `seed`; bei Videos zusaetzlich
     * `draft_cache` (Entwurf) und `duration`. Alles, was nicht gebraucht wird,
     * bleibt unbeachtet.
     */
    result?: { sample?: string; prompt?: string; seed?: number; [key: string]: unknown };
    details?: unknown;
};

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Obergrenze fuer eine durchgereichte Anbieter-Meldung. BFL laeuft auf
 * FastAPI, und dessen 422 fuehrt das beanstandete Feld unter `input` mit —
 * bei `input_image` also das komplette base64. Ungekuerzt landete das in
 * `msg.textContent` **und** in einem Toast: eine Meldung von 132.000 Zeichen
 * fuer einen Fehler, der in einer Zeile zu sagen ist.
 */
const MAX_MELDUNG = 500;

const kuerzeMeldung = (text: string): string =>
    text.length <= MAX_MELDUNG
        ? text
        : `${text.slice(0, MAX_MELDUNG)}… (Meldung gekürzt, ${text.length} Zeichen)`;

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

export type BflRequest = {
    prompt: string;
    model: ModelDefinition;
    size: ResolvedSize;
    format: OutputFormat;
    amount: number;
    revisePrompt: boolean;
    inputImages: InputImage[];
    seed?: number;
    /** Nur FLUX 3: Bounding Boxes, die hinter den Prompt gehaengt werden. */
    layout?: LayoutRow[];
    /** Nur FLUX 3: Web- und Bildsuche vor dem Generieren. */
    grounding?: boolean;
    /**
     * Nur FLUX 3: `aspect_ratio: auto` — das Ergebnis behaelt den Rahmen des
     * ersten Referenzbildes. Fuer Bearbeitungen, bei denen jedes andere
     * Verhaeltnis das Bild beschnitte oder verzerrte.
     */
    autoRatio?: boolean;
};

/**
 * Baut den Rumpf so, wie der jeweilige Endpunkt ihn wirklich auswertet.
 * Am 24.08.2026 nachgemessen: die FLUX.2-Endpunkte und `flux-pro-1.1` nehmen
 * `aspect_ratio` zwar entgegen, **ignorieren es aber** und liefern ihre
 * Standardgroesse. Nur Kontext und `flux-pro-1.1-ultra` werten es aus.
 *
 * FLUX 3 ist strenger: sein Schema verbietet jedes unbekannte Feld (422).
 * Dort darf also nur hinaus, was es kennt — kein `seed`, kein
 * `output_format`, kein `prompt_upsampling`.
 */
export const buildBody = (request: BflRequest, seed?: number): Record<string, unknown> => {
    const { model, size, format, revisePrompt, inputImages } = request;
    const body: Record<string, unknown> = { prompt: composePrompt(request.prompt, request.layout) };
    if (model.acceptsOutputFormat !== false) {
        body.output_format = format === 'webp' ? 'png' : format;
    }
    if (model.sizeMode === 'aspect_ratio_resolution') {
        body.aspect_ratio = request.autoRatio ? 'auto' : size.aspectRatio;
        body.resolution = size.resolution;
    } else if (model.sizeMode === 'aspect_ratio') {
        body.aspect_ratio = size.aspectRatio;
    } else {
        body.width = size.width;
        body.height = size.height;
    }
    if (model.promptRewrite === 'optional') {
        body.prompt_upsampling = revisePrompt;
    }
    if (model.supportsGrounding) {
        // Ausdruecklich mitschicken: BFLs Standard ist `true`, unserer `false`.
        body.grounding = request.grounding ?? false;
    }
    if (model.supportsSeed && seed !== undefined) {
        body.seed = seed;
    }
    const bilder = inputImages.slice(0, model.maxInputImages);
    if (model.inputImageField === 'images') {
        // FLUX 3: eine Liste, im Prompt als <ref_image_0>, <ref_image_1>, …
        if (bilder.length > 0) body.images = bilder.map(image => image.base64);
        return body;
    }
    /**
     * Das erste Bild heisst `input_image`, jedes weitere `input_image_2`,
     * `input_image_3`, … — FLUX.2 rechnet sie einzeln ab (`input_mp` in der
     * Antwort waechst pro Bild). Kontext wertet nur das erste aus.
     */
    bilder.forEach((image, index) => {
        body[index === 0 ? 'input_image' : `input_image_${index + 1}`] = image.base64;
    });
    return body;
};

/**
 * Wie oft das Absenden hoechstens versucht wird, und die Pausen dazwischen —
 * zusammen rund fuenf Sekunden. Grosszuegig bemessen, weil die Generierung
 * selbst zwanzig Sekunden und mehr braucht: fuenf Sekunden laenger warten
 * faellt daneben nicht auf, ein unnoetiger Fehlschlag sehr wohl. Am 25.08.2026
 * lagen der gescheiterte und der geglueckte Versuch neun Sekunden auseinander.
 */
const SUBMIT_ATTEMPTS = 4;
const SUBMIT_BACKOFF_MS = [500, 1_500, 3_000];
/** Bei Lastabwurf laenger warten — BFL bittet um „retry shortly", nicht sofort. */
const SHEDDING_BACKOFF_MS = [3_000, 8_000, 15_000];

/**
 * Lastabwurf: der Endpunkt nimmt gerade nichts an und sagt das auch. Am
 * 07.10.2026 bei FLUX 3 zweimal gesehen, als 503 mit
 * `{"detail": "/v1/flux-3-image is over capacity and temporarily shedding
 * requests. Please retry shortly."}`. Der zweite Versuch Sekunden spaeter lief.
 */
export const isLoadShedding = (error: unknown): boolean => {
    const axiosError = error as AxiosError<{ detail?: unknown }>;
    if (axiosError?.response?.status !== 503) return false;
    const detail = axiosError.response.data?.detail;
    return typeof detail === 'string' && /over capacity|shedding requests/i.test(detail);
};

/**
 * Ob ein gescheitertes Absenden wiederholt werden darf. Die Bedingung ist
 * **enger** als beim Pollen, und das mit Absicht: ein GET kostet nichts, ein
 * POST erzeugt ein bezahltes Bild. Wiederholt wird nur, wo feststeht, dass der
 * Auftrag den Anbieter nicht erreicht hat.
 *
 * - Keine `response`: der Verbindungsaufbau ist gescheitert (DNS, Timeout,
 *   abgewiesene Verbindung). Genau das trat am 25.08.2026 auf — `api.bfl.ai`
 *   loest dual-stack auf, und schlagen alle Adressen fehl, wirft Node einen
 *   `AggregateError` **ohne Message**. In der Oberflaeche stand dann
 *   „bfl_submit_failed:" und nichts dahinter, was wie ein Eingabefehler aussah.
 * - **429**: der Anbieter sagt ausdruecklich, dass er nichts verarbeitet hat.
 *
 * - **503 mit Lastabwurf** (`isLoadShedding`): auch das sagt ausdruecklich,
 *   dass nichts angenommen wurde.
 *
 * **Sonst kein 5xx** — dort kann der Auftrag angenommen und abgerechnet
 * worden sein, und ein zweiter Versuch bezahlte dasselbe Bild doppelt.
 */
export const isRetryableSubmitError = (error: unknown): boolean => {
    if (error instanceof ProviderError) return false;
    const axiosError = error as AxiosError;
    if (!axiosError?.response) return true;
    return axiosError.response.status === 429 || isLoadShedding(error);
};

const submit = (
    model: ModelDefinition,
    body: Record<string, unknown>
): Promise<{ pollingUrl: string; cost?: number }> => submitTo(model.endpoint, body);

/** Absenden an einen BFL-Endpunkt, mit der Wiederholung aus `isRetryableSubmitError`. */
export const submitTo = async (
    endpoint: string,
    body: Record<string, unknown>
): Promise<{ pollingUrl: string; cost?: number }> => {
    for (let versuch = 0; ; versuch++) {
        try {
            const response = await axios.post<BflSubmitResponse>(`${BASE_URL}/${endpoint}`, body, {
                headers: bflHeaders(),
                timeout: 30_000,
            });
            const pollingUrl = response.data?.polling_url;
            if (!pollingUrl) {
                // Frueher lief `pollForResult(undefined)` weiter und warf erst tief
                // in axios — die Ursache stand dann nirgends.
                throw new ProviderError(502, 'bfl_no_polling_url', 'BFL hat keine Polling-URL geliefert.');
            }
            // Die aeltere Generation (`flux-pro-1.1`) liefert hier `null`.
            const cost = typeof response.data?.cost === 'number' ? response.data.cost : undefined;
            return { pollingUrl, cost };
        } catch (error) {
            const fehler = toProviderError(error, 'bfl_submit_failed');
            if (versuch + 1 >= SUBMIT_ATTEMPTS || !isRetryableSubmitError(error)) throw fehler;
            console.warn(`Absenden an BFL, Versuch ${versuch + 1}/${SUBMIT_ATTEMPTS} fehlgeschlagen:`, fehler.message);
            await sleep((isLoadShedding(error) ? SHEDDING_BACKOFF_MS : SUBMIT_BACKOFF_MS)[versuch]);
        }
    }
};

/** Ein Endzustand aus dem Abhol-Body als Fehler — oder `undefined`, wenn es keiner ist. */
const terminalError = (data: BflResultResponse | undefined): ProviderError | undefined => {
    const status = data?.status ?? '';
    const terminal = TERMINAL_STATUS[status];
    if (!terminal) return undefined;
    const detail = data?.details ? ` (${JSON.stringify(data.details)})` : '';
    return new ProviderError(422, `bfl_${status.toLowerCase().replace(/\s+/g, '_')}`, kuerzeMeldung(terminal + detail));
};

export const pollForResult = async (pollUrl: string, deadlineMs: number = POLL_DEADLINE_MS): Promise<ProviderImage> => {
    const result = await pollUntilReady(pollUrl, deadlineMs);
    return { url: result.sample, revisedPrompt: result.prompt, seed: result.seed };
};

/**
 * Pollt bis `Ready` und gibt das ganze `result` zurueck — fuer Videos, deren
 * Ergebnis mehr enthaelt als ein Bild (`draft_cache`, `duration`).
 */
export const pollUntilReady = async (
    pollUrl: string,
    deadlineMs: number = POLL_DEADLINE_MS
): Promise<NonNullable<BflResultResponse['result']> & { sample: string; cost?: number }> => {
    const deadline = Date.now() + deadlineMs;
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
                    throw new ProviderError(502, 'bfl_empty_result', 'BFL meldete „Ready" ohne Ergebnis.');
                }
                // Videos melden `cost` erst hier, auf oberster Ebene — beim Absenden
                // steht dort `null` (am 07.10.2026 gesehen).
                const cost = (response.data as { cost?: unknown })?.cost;
                return { ...response.data?.result, sample, ...(typeof cost === 'number' ? { cost } : {}) };
            }

            const terminal = terminalError(response.data);
            if (terminal) throw terminal;

            // Alles andere ist `Pending`, `Reasoning` (FLUX 3 formuliert gerade
            // aus), `Generating` oder ein neuer Zustand — weiter warten.
            transientErrors = 0;
        } catch (error) {
            if (error instanceof ProviderError) throw error;
            const axiosError = error as AxiosError<BflResultResponse>;
            /**
             * Laut FLUX-3-Doku kommt ein gescheiterter Auftrag auch als HTTP 503
             * mit ganz normalem Body. Erst den Status lesen — sonst wuerde ein
             * endgueltiger Fehler sechsmal wiederholt und dann als
             * „bfl_poll_failed" gemeldet.
             */
            const imBody = terminalError(axiosError.response?.data);
            if (imBody) throw imBody;
            const retryable =
                isRetryableNetworkError(axiosError) || isRetryableHttpStatus(axiosError.response?.status);
            if (!retryable || ++transientErrors > MAX_TRANSIENT_ERRORS) {
                throw toProviderError(error, 'bfl_poll_failed');
            }
        }

        await sleep(wait);
        wait = Math.min(POLL_MAX_MS, Math.round(wait * POLL_FACTOR));
    }

    throw new ProviderError(504, 'bfl_timeout', `Der Anbieter hat innerhalb von ${deadlineMs / 1000} s kein Bild geliefert.`);
};

export const generateImages = async (
    request: BflRequest
): Promise<{ images: ProviderImage[]; errors: string[] }> => {
    const { model, amount, seed } = request;
    // Bei mehreren Bildern jeweils einen eigenen Seed, sonst liefert BFL
    // viermal dasselbe Bild.
    const body = (index: number) => buildBody(request, seed === undefined ? undefined : seed + index);

    const settled = await Promise.allSettled(
        Array.from({ length: amount }, (_, index) =>
            submit(model, body(index)).then(async ({ pollingUrl, cost }) => {
                const image = await pollForResult(pollingUrl, model.pollDeadlineMs);
                return cost === undefined ? image : { ...image, cost: { amount: cost, unit: 'credits' as const } };
            })
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

export const toProviderError = (error: unknown, fallbackCode: string): ProviderError => {
    if (error instanceof ProviderError) return error;
    const axiosError = error as AxiosError<{ detail?: unknown }>;
    const status = axiosError.response?.status ?? 502;
    const detail = axiosError.response?.data?.detail;
    // Am 07.10.2026 so gekommen — als nacktes Englisch sah es wie ein Programmfehler aus.
    if (typeof detail === 'string' && /insufficient credits/i.test(detail)) {
        return new ProviderError(
            402,
            'bfl_insufficient_credits',
            'BFL meldet zu wenig Guthaben für diesen Auftrag. Restguthaben steht auf der Kontoseite.'
        );
    }
    // `axiosError.message` ist nicht immer gefuellt: ein `AggregateError` aus
    // dem gescheiterten Verbindungsaufbau hat gar keine Message, nur `code`.
    // Ohne den Rueckfall stand in der Oberflaeche nichts als der Fehlercode.
    const message = detail
        ? kuerzeMeldung(JSON.stringify(detail))
        : axiosError.message || netzfehlerText(axiosError);
    return new ProviderError(status, fallbackCode, message);
};

const netzfehlerText = (error: AxiosError): string => {
    const code = String(error?.code ?? '');
    const host = new URL(BASE_URL).host;
    return code
        ? `Die Verbindung zu ${host} kam nicht zustande (${code}).`
        : `Die Verbindung zu ${host} kam nicht zustande.`;
};

const isRetryableNetworkError = (error: AxiosError): boolean =>
    ['EAI_AGAIN', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ECONNABORTED'].includes(
        String(error?.code ?? '')
    );

const isRetryableHttpStatus = (status?: number): boolean => {
    if (!status) return false;
    return status === 429 || (status >= 500 && status < 600);
};
