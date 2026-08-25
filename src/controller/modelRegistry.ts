import { AspectRatio, ASPECT_RATIOS, OutputFormat, Quality } from '../types';

export type Provider = 'openai' | 'bfl';

/**
 * Wie das gewaehlte Seitenverhaeltnis beim Anbieter ankommt. Am 24.08.2026
 * gegen die echten APIs geprueft — die Doku ist an dieser Stelle irrefuehrend:
 *
 * - `aspect_ratio`: nur Kontext und `flux-pro-1.1-ultra`. Die FLUX.2-Endpunkte
 *   **nehmen das Feld an und ignorieren es** (Antwort dann stur 1024x1024),
 *   was genau der Grund ist, warum das Seitenverhaeltnis bisher nicht griff.
 * - `width_height`: FLUX.2 (Vielfache von 16) und `flux-pro-1.1` (32).
 * - `pixel_size`: OpenAI, als `size`-String.
 */
export type SizeMode = 'aspect_ratio' | 'width_height' | 'pixel_size';

export type ModelDefinition = {
    id: string;
    provider: Provider;
    label: string;
    /** Kurzer Hinweis, wofuer das Modell taugt — steht so in der UI. */
    hint: string;
    /** Pfadsegment hinter `https://api.bfl.ai/v1/` bzw. die OpenAI-Model-ID. */
    endpoint: string;
    sizeMode: SizeMode;
    ratios: readonly AspectRatio[];
    /** Leer = das Modell kennt keine Qualitaetsstufen. */
    qualities: readonly Quality[];
    formats: readonly OutputFormat[];
    maxAmount: number;
    /** Nur für `width_height`: Kantenraster und Grenzen. */
    /**
     * Kantenraster und Grenzen. `max` ist die größte erlaubte **Kante**,
     * `maxPixels` die größte erlaubte **Fläche**.
     *
     * Beides ist nötig, weil die Anbieter verschieden begrenzen: FLUX.2
     * akzeptiert 3040×1360, obwohl eine Kante über 2048 liegt — dort zählt
     * allein die Fläche (am 25.08.2026 nachgemessen). OpenAI begrenzt beides.
     */
    edge?: { multiple: number; min: number; max: number; maxPixels?: number };
    /** Nur für `pixel_size`: feste Groessen; fehlt = freie Größe. */
    fixedSizes?: readonly string[];
    /** BFL schreibt den Prompt auf Wunsch um (`prompt_upsampling`). */
    supportsRevisePrompt: boolean;
    /**
     * Wie viele Referenzbilder das Modell auswertet. 0 heisst: keine.
     * Am 24.08.2026 nachgemessen — `flux-pro-1.1` nimmt `input_image` zwar
     * entgegen, erzeugt aber ein voellig neues Bild.
     */
    maxInputImages: number;
    supportsSeed: boolean;
    /** Grobe Einordnung der Kosten, damit die Wahl bewusst faellt. */
    cost: 'low' | 'medium' | 'high';
};

const ALL_RATIOS = ASPECT_RATIOS;
/** OpenAI deckt mit drei festen Groessen nur diese drei Verhaeltnisse ab. */
const FIXED_RATIOS = ['3:2', '1:1', '2:3'] as const;
const OPENAI_FIXED_SIZES = ['1024x1024', '1536x1024', '1024x1536'] as const;

export const MODELS: readonly ModelDefinition[] = [
    {
        id: 'flux-2-pro',
        provider: 'bfl',
        label: 'FLUX.2 [pro]',
        hint: 'Standardwahl. Schnell, sehr gute Bildqualität, freie Größe.',
        endpoint: 'flux-2-pro',
        sizeMode: 'width_height',
        ratios: ALL_RATIOS,
        qualities: ['low', 'medium', 'high'],
        formats: ['png', 'jpeg'],
        maxAmount: 4,
        edge: { multiple: 16, min: 256, max: 4096, maxPixels: 4_194_304 },
        supportsRevisePrompt: true,
        maxInputImages: 4,
        supportsSeed: true,
        cost: 'medium',
    },
    {
        id: 'flux-2-flex',
        provider: 'bfl',
        label: 'FLUX.2 [flex]',
        hint: 'Mehr Kontrolle und Detailtreue als [pro], dafür langsamer.',
        endpoint: 'flux-2-flex',
        sizeMode: 'width_height',
        ratios: ALL_RATIOS,
        qualities: ['low', 'medium', 'high'],
        formats: ['png', 'jpeg'],
        maxAmount: 4,
        edge: { multiple: 16, min: 256, max: 4096, maxPixels: 4_194_304 },
        supportsRevisePrompt: true,
        maxInputImages: 4,
        supportsSeed: true,
        cost: 'high',
    },
    {
        id: 'flux-2-max',
        provider: 'bfl',
        label: 'FLUX.2 [max]',
        hint: 'Das stärkste FLUX-Modell. Für Motive, an denen [pro] scheitert.',
        endpoint: 'flux-2-max',
        sizeMode: 'width_height',
        ratios: ALL_RATIOS,
        qualities: ['low', 'medium', 'high'],
        formats: ['png', 'jpeg'],
        maxAmount: 4,
        edge: { multiple: 16, min: 256, max: 4096, maxPixels: 4_194_304 },
        supportsRevisePrompt: true,
        maxInputImages: 4,
        supportsSeed: true,
        cost: 'high',
    },
    {
        id: 'flux-2-klein-9b',
        provider: 'bfl',
        label: 'FLUX.2 [klein] 9B',
        hint: 'Günstig und schnell. Gut für Entwürfe und viele Varianten.',
        endpoint: 'flux-2-klein-9b',
        sizeMode: 'width_height',
        ratios: ALL_RATIOS,
        qualities: ['low', 'medium', 'high'],
        formats: ['png', 'jpeg'],
        maxAmount: 4,
        edge: { multiple: 16, min: 256, max: 4096, maxPixels: 4_194_304 },
        supportsRevisePrompt: true,
        maxInputImages: 4,
        supportsSeed: true,
        cost: 'low',
    },
    {
        id: 'flux-pro-1.1',
        provider: 'bfl',
        label: 'FLUX1.1 [pro]',
        hint: 'Vorgängergeneration. Schnell, günstig, bis 1440 px Kante.',
        endpoint: 'flux-pro-1.1',
        sizeMode: 'width_height',
        ratios: ALL_RATIOS,
        qualities: ['low', 'medium'],
        formats: ['png', 'jpeg'],
        maxAmount: 4,
        edge: { multiple: 32, min: 256, max: 1440 },
        supportsRevisePrompt: true,
        maxInputImages: 0,
        supportsSeed: true,
        cost: 'low',
    },
    {
        id: 'flux-pro-1.1-ultra',
        provider: 'bfl',
        label: 'FLUX1.1 [pro] ultra',
        hint: 'Bis 4 Megapixel. Für Druck und große Formate.',
        endpoint: 'flux-pro-1.1-ultra',
        sizeMode: 'aspect_ratio',
        ratios: ALL_RATIOS,
        qualities: [],
        formats: ['png', 'jpeg'],
        maxAmount: 4,
        supportsRevisePrompt: false,
        maxInputImages: 0,
        supportsSeed: true,
        cost: 'medium',
    },
    {
        id: 'flux-kontext-pro',
        provider: 'bfl',
        label: 'FLUX.1 Kontext [pro]',
        hint: 'Auf Bildbearbeitung ausgelegt; nimmt Seitenverhältnis direkt.',
        endpoint: 'flux-kontext-pro',
        sizeMode: 'aspect_ratio',
        ratios: ALL_RATIOS,
        qualities: [],
        formats: ['png', 'jpeg'],
        maxAmount: 4,
        supportsRevisePrompt: true,
        maxInputImages: 1,
        supportsSeed: true,
        cost: 'medium',
    },
    {
        id: 'flux-kontext-max',
        provider: 'bfl',
        label: 'FLUX.1 Kontext [max]',
        hint: 'Wie Kontext [pro], stärker bei Typografie und Detailtreue.',
        endpoint: 'flux-kontext-max',
        sizeMode: 'aspect_ratio',
        ratios: ALL_RATIOS,
        qualities: [],
        formats: ['png', 'jpeg'],
        maxAmount: 4,
        supportsRevisePrompt: true,
        maxInputImages: 1,
        supportsSeed: true,
        cost: 'high',
    },
    {
        id: 'gpt-image-2',
        provider: 'openai',
        label: 'OpenAI GPT Image 2',
        hint: 'Beste Wahl für Text im Bild und präzise Vorgaben. Freie Größe.',
        endpoint: 'gpt-image-2',
        sizeMode: 'pixel_size',
        ratios: ALL_RATIOS,
        qualities: ['low', 'medium', 'high', 'max'],
        formats: ['png', 'jpeg', 'webp'],
        maxAmount: 4,
        edge: { multiple: 16, min: 256, max: 3840, maxPixels: 8_294_400 },
        supportsRevisePrompt: false,
        maxInputImages: 4,
        supportsSeed: false,
        cost: 'high',
    },
    {
        id: 'gpt-image-1.5',
        provider: 'openai',
        label: 'OpenAI GPT Image 1.5',
        hint: 'Günstiger als GPT Image 2, aber nur drei feste Größen.',
        endpoint: 'gpt-image-1.5',
        sizeMode: 'pixel_size',
        ratios: FIXED_RATIOS,
        qualities: ['low', 'medium', 'high'],
        formats: ['png', 'jpeg', 'webp'],
        maxAmount: 4,
        fixedSizes: OPENAI_FIXED_SIZES,
        supportsRevisePrompt: false,
        maxInputImages: 4,
        supportsSeed: false,
        cost: 'medium',
    },
    {
        id: 'gpt-image-1-mini',
        provider: 'openai',
        label: 'OpenAI GPT Image 1 mini',
        hint: 'Die günstigste OpenAI-Stufe. Für Entwürfe.',
        endpoint: 'gpt-image-1-mini',
        sizeMode: 'pixel_size',
        ratios: FIXED_RATIOS,
        qualities: ['low', 'medium', 'high'],
        formats: ['png', 'jpeg', 'webp'],
        maxAmount: 4,
        fixedSizes: OPENAI_FIXED_SIZES,
        supportsRevisePrompt: false,
        maxInputImages: 4,
        supportsSeed: false,
        cost: 'low',
    },
];

/**
 * OpenAI rechnet Bilder ueber Tokens ab — Dollar je Million, getrennt nach
 * Text-Eingabe, Bild-Eingabe und Bild-Ausgabe. Die Antwort liefert die
 * Tokenzahlen genau aufgeschlüsselt, damit ist der Betrag exakt und nicht
 * geschätzt.
 *
 * **Stand 25.08.2026** von der OpenAI-Preisseite. Preise ändern sich; wenn die
 * Beträge auf der Kontoseite von der Abrechnung abweichen, ist das hier die
 * erste Stelle zum Nachsehen. BFL braucht so eine Tabelle nicht — dort steht
 * `cost` in Credits schon in der Antwort.
 */
export type TokenPrice = { textInput: number; imageInput: number; imageOutput: number };

export const OPENAI_PRICES_USD_PER_MILLION: Record<string, TokenPrice> = {
    'gpt-image-2': { textInput: 5, imageInput: 8, imageOutput: 30 },
    'gpt-image-1.5': { textInput: 5, imageInput: 8, imageOutput: 32 },
    'gpt-image-1': { textInput: 5, imageInput: 10, imageOutput: 40 },
    'gpt-image-1-mini': { textInput: 2, imageInput: 2.5, imageOutput: 8 },
};

export type TokenUsage = {
    textInput: number;
    imageInput: number;
    imageOutput: number;
};

/** Dollarbetrag aus den Tokenzahlen. `null`, wenn das Modell unbekannt ist. */
export const openAiCost = (modelId: string, usage: TokenUsage): number | null => {
    const price = OPENAI_PRICES_USD_PER_MILLION[modelId];
    if (!price) return null;
    const betrag =
        (usage.textInput * price.textInput +
            usage.imageInput * price.imageInput +
            usage.imageOutput * price.imageOutput) /
        1_000_000;
    // Auf einen Zehntelcent runden — darunter ist die Zahl Rauschen.
    return Math.round(betrag * 10_000) / 10_000;
};

export type ModelId = string;

export const DEFAULT_MODEL = 'flux-2-pro';

export const findModel = (id: string | undefined): ModelDefinition | undefined =>
    MODELS.find(m => m.id === id);

/** Nur die Modelle, deren Anbieter auch einen Schluessel hinterlegt hat. */
export const availableModels = (has: Record<Provider, boolean>): ModelDefinition[] =>
    MODELS.filter(m => has[m.provider]);
