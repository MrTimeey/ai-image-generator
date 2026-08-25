import { ModelId, Provider } from './controller/modelRegistry';

export type ApplicationConfig = {
    port: number;
    publicBaseUrl: string;
    openai: {
        apiKey: string;
        organization: string;
        /** Getrennter Admin-Key (`sk-admin-…`), nur fuer die Kostenabfrage. */
        adminKey: string;
    };
    bfl: {
        apiKey: string;
    };
    baseFolder: string;
    enableAuth: boolean;
    isProduction: boolean;
    auth: {
        sessionSecret: string;
        issuer: string;
        clientId: string;
        clientSecret: string;
        allowedGroup: string;
    };
};

/**
 * Ein einziges Vokabular fuer alle Anbieter. Was daraus wird — `aspect_ratio`,
 * `width`/`height` oder ein `size`-String — entscheidet die Model-Registry;
 * siehe `common/aspectRatio.ts`.
 */
export const ASPECT_RATIOS = ['21:9', '16:9', '3:2', '4:3', '1:1', '3:4', '2:3', '9:16', '9:21'] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

/**
 * `max` reizt aus, was das Modell hergibt. Die Stufe steht **nur** an
 * Modellen, bei denen das spuerbar mehr ist als `high` — praktisch also an
 * `gpt-image-2` mit 8,3 Megapixeln (3840x2160 bei 16:9). FLUX.2 endet bei
 * 4 Megapixeln, dort waere `max` gerade fuenf Prozent ueber `high` und damit
 * ein Versprechen, das die Stufe nicht haelt.
 */
export const QUALITIES = ['low', 'medium', 'high', 'max'] as const;
export type Quality = (typeof QUALITIES)[number];

export const OUTPUT_FORMATS = ['png', 'jpeg', 'webp'] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export enum Sorting {
    ASCENDING = 'ASC',
    DESCENDING = 'DESC',
}

/**
 * Was ein Bild gekostet hat. Zwei Waehrungen, weil die Anbieter verschieden
 * abrechnen: BFL in eigenen Credits, OpenAI in Dollar (aus Tokens gerechnet).
 * Eine Umrechnung waere geraten — also bleiben sie getrennt.
 */
export type Cost = { amount: number; unit: 'credits' | 'usd' };

/** Was ein Provider-Controller zurueckgibt: entweder eine URL oder Bytes. */
export type ProviderImage = {
    /** Von BFL; laeuft nach ~10 Minuten ab und muss sofort geladen werden. */
    url?: string;
    /** Von OpenAI; `gpt-image-*` liefert ausschliesslich base64. */
    buffer?: Buffer;
    revisedPrompt?: string;
    seed?: number;
    cost?: Cost;
};

export type GeneratedImage = {
    id: string;
    fileName: string;
    /** An der fertigen Datei gemessen, nicht aus dem Wunsch abgeleitet. */
    width: number;
    height: number;
    revisedPrompt?: string;
    seed?: number;
    cost?: Cost;
};

export type GenerationResult = {
    createdAt: string;
    model: ModelId;
    provider: Provider;
    description: string;
    width: number;
    height: number;
    images: GeneratedImage[];
    /** Teilfehler bei `amount > 1`. Leer heisst: alles hat geklappt. */
    errors: string[];
};

export type ImageDataStore = {
    entries: number;
    data: DataImage[];
};

export type DataImage = {
    id: string;
    fileName?: string;
    createdAt: string;
    description: string;
    revisedPrompt: string;
    model?: string;
    provider?: string;
    ratio?: string;
    width?: number;
    height?: number;
    /** Dateinamen der mitgegebenen Referenzbilder, klein abgelegt. */
    referenceImages?: string[];
    /** Vom Nutzer markiert. Fehlt bei allem, was nie angefasst wurde. */
    favorite?: boolean;
    /**
     * Die Einstellungen des Laufs — damit „nochmal genauso, nur anders"
     * moeglich wird. Fehlen bei allem, was vor dieser Aenderung entstand.
     */
    seed?: number;
    quality?: string;
    outputFormat?: string;
    cost?: number;
    costUnit?: string;
    /** Wie lange der Anbieter gebraucht hat, in Millisekunden. */
    durationMs?: number;
    /**
     * Der alte Feldname aus der Zeit von DALL-E. Wird nur noch **gelesen**,
     * damit vorhandene `data.json`-Eintraege ihr Modell behalten; neue
     * Eintraege schreiben `model`.
     */
    languageModel?: string;
    /** Frueher die Anbieter-URL. Laengst abgelaufen, bleibt fuer Altdaten. */
    url?: string;
};
