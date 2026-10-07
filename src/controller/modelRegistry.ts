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
 * - `aspect_ratio_resolution`: FLUX 3. Verhaeltnis plus eine Flaechenstufe
 *   (`resolution`), die genauen Kanten waehlt der Anbieter.
 */
export type SizeMode = 'aspect_ratio' | 'width_height' | 'pixel_size' | 'aspect_ratio_resolution';

/**
 * Ob der Anbieter den Prompt umformuliert, bevor er rechnet:
 *
 * - `never`: der Prompt kommt woertlich an.
 * - `optional`: nur auf ausdruecklichen Wunsch (`prompt_upsampling`), sonst
 *   woertlich. Der Standard ist **aus**: Agenten schreiben ohnehin
 *   ausfuehrliche Prompts und wollen sie nicht umgeschrieben sehen.
 * - `always`: nicht abschaltbar. FLUX 3 formuliert jeden Prompt aus (Status
 *   `Reasoning`, Ergebnis in `result.prompt`); verbindlich sind dort nur die
 *   Boxen eines Layouts.
 */
export type PromptRewrite = 'never' | 'optional' | 'always';

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
    promptRewrite: PromptRewrite;
    /**
     * Wie viele Referenzbilder das Modell auswertet. 0 heisst: keine.
     * Am 24.08.2026 nachgemessen — `flux-pro-1.1` nimmt `input_image` zwar
     * entgegen, erzeugt aber ein voellig neues Bild.
     */
    maxInputImages: number;
    supportsSeed: boolean;
    /**
     * Nur OpenAI: die API kennt `xhigh` und `max` selbst — bei GPT Image 2.5
     * sind das reine Rechenstufen, die Aufloesung bleibt (am 07.10.2026
     * gemessen). Fehlt das, ist `max` allein unser Begriff fuer die groesste
     * Aufloesung und geht als `high` hinaus.
     */
    apiKnowsXhighMax?: boolean;
    /** Nur `aspect_ratio_resolution`: welche `resolution` je Qualitaetsstufe hinausgeht. */
    resolutions?: Partial<Record<Quality, string>>;
    /**
     * Wie Referenzbilder heissen: `input_image`, `input_image_2`, … (FLUX.2,
     * Kontext) oder eine Liste `images` (FLUX 3). Fehlt = die alte Form.
     */
    inputImageField?: 'input_image_n' | 'images';
    /** Nimmt Bounding Boxes im Prompt an (FLUX 3). */
    supportsLayout?: boolean;
    /** Kennt `grounding`: Web- und Bildsuche vor dem Generieren (FLUX 3). */
    supportsGrounding?: boolean;
    /**
     * Ob der Endpunkt `output_format` kennt. FLUX 3 nicht — sein Schema
     * verbietet unbekannte Felder (422). Dort wird das gelieferte Bild
     * hinterher ins gewuenschte Format umgerechnet.
     */
    acceptsOutputFormat?: boolean;
    /** Wie lange hoechstens gepollt wird. Fehlt = der Standard des Controllers. */
    pollDeadlineMs?: number;
    /** Grobe Einordnung der Kosten, damit die Wahl bewusst faellt. */
    cost: 'low' | 'medium' | 'high';
};

const ALL_RATIOS = ASPECT_RATIOS;
/** OpenAI deckt mit drei festen Groessen nur diese drei Verhaeltnisse ab. */
const FIXED_RATIOS = ['3:2', '1:1', '2:3'] as const;
const OPENAI_FIXED_SIZES = ['1024x1024', '1536x1024', '1024x1536'] as const;

export const MODELS: readonly ModelDefinition[] = [
    {
        id: 'flux-3-image',
        provider: 'bfl',
        label: 'FLUX 3 [image]',
        hint: 'Neueste Generation. Elemente per Box platzieren, gezielt bearbeiten, bis 10 Referenzen, bis 4K. Formuliert den Prompt immer aus.',
        endpoint: 'flux-3-image',
        sizeMode: 'aspect_ratio_resolution',
        ratios: ALL_RATIOS,
        qualities: ['low', 'medium', 'high', 'max'],
        /**
         * Entlang der Pixel-Leiter der anderen Modelle (low ≈ 1, medium ≈ 2,
         * high ≈ 4 MP, max = was geht). `768sq` fehlt bewusst: 0,6 MP fuer
         * 0,007 $ weniger als `1k`.
         */
        resolutions: { low: '1k', medium: '1.5k', high: '2k', max: '4k' },
        formats: ['png', 'jpeg', 'webp'],
        maxAmount: 4,
        promptRewrite: 'always',
        maxInputImages: 10,
        inputImageField: 'images',
        supportsSeed: false,
        supportsLayout: true,
        supportsGrounding: true,
        acceptsOutputFormat: false,
        // Ausformulieren, ggf. Websuche und 4K brauchen spuerbar laenger.
        pollDeadlineMs: 300_000,
        cost: 'medium',
    },
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
        promptRewrite: 'optional',
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
        promptRewrite: 'optional',
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
        promptRewrite: 'optional',
        maxInputImages: 4,
        supportsSeed: true,
        cost: 'high',
    },
    {
        id: 'flux-2-klein-9b',
        provider: 'bfl',
        label: 'FLUX.2 [klein] 9B',
        hint: 'Günstig und schnell. Gut für Entwürfe und viele Varianten.',
        // Laut BFL-Doku ohne Prompt-Upsampling — die Option war hier ein
        // Versprechen, das der Endpunkt nicht haelt.
        endpoint: 'flux-2-klein-9b',
        sizeMode: 'width_height',
        ratios: ALL_RATIOS,
        qualities: ['low', 'medium', 'high'],
        formats: ['png', 'jpeg'],
        maxAmount: 4,
        edge: { multiple: 16, min: 256, max: 4096, maxPixels: 4_194_304 },
        promptRewrite: 'never',
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
        promptRewrite: 'optional',
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
        promptRewrite: 'never',
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
        promptRewrite: 'optional',
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
        promptRewrite: 'optional',
        maxInputImages: 1,
        supportsSeed: true,
        cost: 'high',
    },
    {
        id: 'gpt-image-2.5-flare',
        provider: 'openai',
        label: 'OpenAI GPT Image 2.5 Flare',
        hint: 'Beste Wahl für Text im Bild und präzise Vorgaben. Schnell, freie Größe.',
        endpoint: 'gpt-image-2.5-flare',
        sizeMode: 'pixel_size',
        ratios: ALL_RATIOS,
        qualities: ['low', 'medium', 'high', 'xhigh', 'max'],
        formats: ['png', 'jpeg', 'webp'],
        maxAmount: 4,
        edge: { multiple: 16, min: 256, max: 3840, maxPixels: 8_294_400 },
        promptRewrite: 'never',
        // Laut Doku bis 16; am 07.10.2026 wurden sogar 17 angenommen.
        maxInputImages: 16,
        supportsSeed: false,
        apiKnowsXhighMax: true,
        cost: 'medium',
    },
    {
        id: 'gpt-image-2.5-sunburst',
        provider: 'openai',
        label: 'OpenAI GPT Image 2.5 Sunburst',
        hint: 'Höchste Bildqualität bei OpenAI, hält Personen und Materialien über Bearbeitungen stabil. Langsam.',
        endpoint: 'gpt-image-2.5-sunburst',
        sizeMode: 'pixel_size',
        ratios: ALL_RATIOS,
        qualities: ['low', 'medium', 'high', 'xhigh', 'max'],
        formats: ['png', 'jpeg', 'webp'],
        maxAmount: 4,
        edge: { multiple: 16, min: 256, max: 3840, maxPixels: 8_294_400 },
        promptRewrite: 'never',
        maxInputImages: 16,
        supportsSeed: false,
        apiKnowsXhighMax: true,
        cost: 'medium',
    },
    {
        id: 'gpt-image-2',
        provider: 'openai',
        label: 'OpenAI GPT Image 2',
        hint: 'Vorgänger von GPT Image 2.5: langsamer und je Stufe teurer.',
        endpoint: 'gpt-image-2',
        sizeMode: 'pixel_size',
        ratios: ALL_RATIOS,
        qualities: ['low', 'medium', 'high', 'max'],
        formats: ['png', 'jpeg', 'webp'],
        maxAmount: 4,
        edge: { multiple: 16, min: 256, max: 3840, maxPixels: 8_294_400 },
        promptRewrite: 'never',
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
        promptRewrite: 'never',
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
        promptRewrite: 'never',
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
 * **Stand 07.10.2026** von der OpenAI-Preisseite. Preise ändern sich; wenn die
 * Beträge auf der Kontoseite von der Abrechnung abweichen, ist das hier die
 * erste Stelle zum Nachsehen. BFL braucht so eine Tabelle nicht — dort steht
 * `cost` in Credits schon in der Antwort.
 */
export type TokenPrice = { textInput: number; imageInput: number; imageOutput: number };

export const OPENAI_PRICES_USD_PER_MILLION: Record<string, TokenPrice> = {
    'gpt-image-2.5-flare': { textInput: 5, imageInput: 8, imageOutput: 30 },
    'gpt-image-2.5-sunburst': { textInput: 5, imageInput: 8, imageOutput: 30 },
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
