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

export const QUALITIES = ['low', 'medium', 'high'] as const;
export type Quality = (typeof QUALITIES)[number];

export const OUTPUT_FORMATS = ['png', 'jpeg', 'webp'] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export enum Sorting {
    ASCENDING = 'ASC',
    DESCENDING = 'DESC',
}

/** Was ein Provider-Controller zurueckgibt: entweder eine URL oder Bytes. */
export type ProviderImage = {
    /** Von BFL; laeuft nach ~10 Minuten ab und muss sofort geladen werden. */
    url?: string;
    /** Von OpenAI; `gpt-image-*` liefert ausschliesslich base64. */
    buffer?: Buffer;
    revisedPrompt?: string;
    seed?: number;
};

export type GeneratedImage = {
    id: string;
    fileName: string;
    /** An der fertigen Datei gemessen, nicht aus dem Wunsch abgeleitet. */
    width: number;
    height: number;
    revisedPrompt?: string;
    seed?: number;
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
    /**
     * Der alte Feldname aus der Zeit von DALL-E. Wird nur noch **gelesen**,
     * damit vorhandene `data.json`-Eintraege ihr Modell behalten; neue
     * Eintraege schreiben `model`.
     */
    languageModel?: string;
    /** Frueher die Anbieter-URL. Laengst abgelaufen, bleibt fuer Altdaten. */
    url?: string;
};
