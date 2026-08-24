import axios from 'axios';
import appConfig, { hasProvider } from '../common/appConfig';

/**
 * Guthaben und Kosten der beiden Anbieter — damit die Zahlen dort stehen, wo
 * die Bilder entstehen, statt in zwei Dashboards, die man jedes Mal sucht.
 *
 * Wichtig: **OpenAI gibt das Restguthaben ueber keine API heraus.**
 * `/v1/dashboard/billing/*` antwortet API-Keys mit 403, und
 * `/v1/organization/costs` braucht einen Admin-Key (`sk-admin-…`) mit dem
 * Scope `api.usage.read`. Selbst damit kommen nur die **Kosten** heraus, nie
 * der Kontostand. Deshalb: BFL echtes Guthaben, OpenAI die Ausgaben des
 * laufenden Monats, sofern ein Admin-Key hinterlegt ist.
 */
export type ProviderCredits = {
    provider: 'bfl' | 'openai';
    label: string;
    /** Was gemessen wurde — `balance` ist ein Kontostand, `spend` sind Ausgaben. */
    kind: 'balance' | 'spend' | 'unavailable';
    value?: number;
    unit?: string;
    hint?: string;
    topUpUrl: string;
};

const CACHE_MS = 60_000;
let cache: { at: number; data: ProviderCredits[] } | null = null;

const BFL_TOP_UP = 'https://dashboard.bfl.ai/';
const OPENAI_TOP_UP = 'https://platform.openai.com/settings/organization/billing/overview';

const bflCredits = async (): Promise<ProviderCredits> => {
    const base: ProviderCredits = {
        provider: 'bfl',
        label: 'Black Forest Labs',
        kind: 'unavailable',
        topUpUrl: BFL_TOP_UP,
    };
    if (!hasProvider.bfl) return { ...base, hint: 'Kein Schlüssel hinterlegt.' };
    try {
        const response = await axios.get<{ credits?: number }>('https://api.bfl.ai/v1/credits', {
            headers: { accept: 'application/json', 'x-key': appConfig.bfl.apiKey },
            timeout: 15_000,
        });
        const credits = response.data?.credits;
        if (typeof credits !== 'number') {
            return { ...base, hint: 'Antwort ohne Guthaben.' };
        }
        return { ...base, kind: 'balance', value: credits, unit: 'Credits' };
    } catch (error) {
        return { ...base, hint: describe(error) };
    }
};

const openAiSpend = async (): Promise<ProviderCredits> => {
    const base: ProviderCredits = {
        provider: 'openai',
        label: 'OpenAI',
        kind: 'unavailable',
        topUpUrl: OPENAI_TOP_UP,
    };
    if (!hasProvider.openai) return { ...base, hint: 'Kein Schlüssel hinterlegt.' };
    if (!appConfig.openai.adminKey) {
        return {
            ...base,
            hint: 'OpenAI gibt den Kontostand über keine API heraus. Für die Ausgaben des Monats einen Admin-Key (OPEN_AI_ADMIN_KEY) mit dem Scope api.usage.read hinterlegen.',
        };
    }
    try {
        // Ab dem Ersten des laufenden Monats, in ganzen Tagen gebuendelt.
        const now = new Date();
        const start = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) / 1000);
        const response = await axios.get<{ data?: { results?: { amount?: { value?: number; currency?: string } }[] }[] }>(
            'https://api.openai.com/v1/organization/costs',
            {
                params: { start_time: start, bucket_width: '1d', limit: 31 },
                headers: { Authorization: `Bearer ${appConfig.openai.adminKey}` },
                timeout: 20_000,
            }
        );
        let total = 0;
        let currency = 'usd';
        for (const bucket of response.data?.data ?? []) {
            for (const result of bucket.results ?? []) {
                total += result.amount?.value ?? 0;
                if (result.amount?.currency) currency = result.amount.currency;
            }
        }
        return {
            ...base,
            kind: 'spend',
            value: Math.round(total * 100) / 100,
            unit: currency.toUpperCase(),
            hint: 'Ausgaben im laufenden Monat — OpenAI gibt den Kontostand nicht heraus.',
        };
    } catch (error) {
        return { ...base, hint: describe(error) };
    }
};

const describe = (error: unknown): string => {
    if (axios.isAxiosError(error)) {
        const detail = (error.response?.data as { error?: { message?: string }; detail?: unknown } | undefined);
        const message = detail?.error?.message ?? (detail?.detail ? JSON.stringify(detail.detail) : undefined);
        return `${error.response?.status ?? ''} ${message ?? error.message}`.trim();
    }
    return error instanceof Error ? error.message : String(error);
};

export const getCredits = async (force = false): Promise<ProviderCredits[]> => {
    // Ein kurzer Cache reicht: die Zahlen aendern sich nur, wenn hier Bilder
    // entstehen, und die Kontoseite wird oft neu geladen.
    if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.data;
    const data = await Promise.all([bflCredits(), openAiSpend()]);
    cache = { at: Date.now(), data };
    return data;
};
