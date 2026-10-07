import { describe, expect, it } from 'vitest';
import {
    availableModels,
    DEFAULT_MODEL,
    findModel,
    MODELS,
    openAiCost,
    OPENAI_PRICES_USD_PER_MILLION,
} from './modelRegistry';
import { ASPECT_RATIOS, OUTPUT_FORMATS, QUALITIES } from '../types';

describe('Registry ist in sich stimmig', () => {
    it('hat eindeutige Kennungen', () => {
        const ids = MODELS.map(m => m.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('kennt das Standardmodell', () => {
        expect(findModel(DEFAULT_MODEL)).toBeDefined();
    });

    it('nennt nur Verhältnisse, Stufen und Formate, die es gibt', () => {
        for (const model of MODELS) {
            for (const ratio of model.ratios) expect(ASPECT_RATIOS).toContain(ratio);
            for (const stufe of model.qualities) expect(QUALITIES).toContain(stufe);
            for (const format of model.formats) expect(OUTPUT_FORMATS).toContain(format);
            expect(model.formats.length).toBeGreaterThan(0);
            expect(model.ratios.length).toBeGreaterThan(0);
        }
    });

    it('gibt jedem Modell mit fester Größe auch feste Größen mit', () => {
        for (const model of MODELS) {
            if (model.fixedSizes) {
                expect(model.sizeMode).toBe('pixel_size');
                expect(model.fixedSizes.length).toBeGreaterThan(0);
            }
            // Wer nach Kanten rechnet, braucht ein Raster.
            if (model.sizeMode === 'width_height') expect(model.edge).toBeDefined();
        }
    });

    it('hinterlegt für jedes OpenAI-Modell einen Preis', () => {
        // Sonst zeigt die Kostenanzeige „unbekannt", ohne dass es auffällt.
        for (const model of MODELS.filter(m => m.provider === 'openai')) {
            expect(OPENAI_PRICES_USD_PER_MILLION[model.endpoint]).toBeDefined();
        }
    });

    it('erlaubt Referenzbilder nur, wo sie auch ausgewertet werden', () => {
        // Am 24.08.2026 gemessen: flux-pro-1.1 nimmt ein Referenzbild entgegen
        // und erzeugt trotzdem ein völlig neues — deshalb steht dort 0.
        expect(findModel('flux-pro-1.1')?.maxInputImages).toBe(0);
        expect(findModel('flux-pro-1.1-ultra')?.maxInputImages).toBe(0);
        expect(findModel('flux-2-pro')?.maxInputImages).toBeGreaterThan(0);
        expect(findModel('flux-kontext-pro')?.maxInputImages).toBe(1);
    });

    it('sagt bei jedem Modell, wie es mit dem Prompt umgeht', () => {
        for (const model of MODELS) expect(['never', 'optional', 'always']).toContain(model.promptRewrite);
        // Laut BFL-Doku hat Klein kein Prompt-Upsampling — die Option wäre gelogen.
        expect(findModel('flux-2-klein-9b')?.promptRewrite).toBe('never');
        // FLUX 3 formuliert immer aus, abschalten lässt es sich nicht.
        expect(findModel('flux-3-image')?.promptRewrite).toBe('always');
    });

    it('gibt jeder Stufe eines Flächenstufen-Modells eine `resolution`', () => {
        for (const model of MODELS.filter(m => m.sizeMode === 'aspect_ratio_resolution')) {
            for (const stufe of model.qualities) expect(model.resolutions?.[stufe]).toBeDefined();
        }
    });

    it('bietet Layouts nur an, wo die Referenzbilder als `images` hinausgehen', () => {
        // Bearbeiten-Layouts zählen `ref_image_0`, `ref_image_1`, … — das
        // gibt es nur bei der Listenform von FLUX 3.
        for (const model of MODELS.filter(m => m.supportsLayout)) {
            expect(model.provider).toBe('bfl');
            expect(model.inputImageField).toBe('images');
        }
    });

    it('schickt `xhigh` nur an Modelle, deren API es kennt', () => {
        for (const model of MODELS) {
            if (model.qualities.includes('xhigh')) expect(model.apiKnowsXhighMax).toBe(true);
        }
    });
});

describe('availableModels', () => {
    it('zeigt nur, wofür ein Schlüssel hinterlegt ist', () => {
        const nurBfl = availableModels({ bfl: true, openai: false });
        expect(nurBfl.every(m => m.provider === 'bfl')).toBe(true);
        expect(nurBfl.length).toBeGreaterThan(0);

        const nurOpenAi = availableModels({ bfl: false, openai: true });
        expect(nurOpenAi.every(m => m.provider === 'openai')).toBe(true);

        expect(availableModels({ bfl: false, openai: false })).toHaveLength(0);
    });
});

describe('openAiCost', () => {
    it('rechnet den gemessenen Fall nach', () => {
        // Echte Antwort von gpt-image-1-mini (25.08.2026): 9 Text-Tokens ein,
        // 272 Bild-Tokens aus. 9 × 2 $/Mio + 272 × 8 $/Mio = 0,002194 $.
        expect(openAiCost('gpt-image-1-mini', { textInput: 9, imageInput: 0, imageOutput: 272 })).toBeCloseTo(0.0022, 4);
    });

    it('rechnet Bild-Eingabe zum eigenen Satz', () => {
        // gpt-image-2: Bild ein 8 $/Mio, Bild aus 30 $/Mio.
        expect(openAiCost('gpt-image-2', { textInput: 0, imageInput: 1_000_000, imageOutput: 0 })).toBe(8);
        expect(openAiCost('gpt-image-2', { textInput: 0, imageInput: 0, imageOutput: 1_000_000 })).toBe(30);
    });

    it('rechnet den gemessenen 4K-Fall von GPT Image 2.5 nach', () => {
        // Echte Antwort von gpt-image-2.5-flare (07.10.2026), 3840×2160 mit
        // `max`: 16 Text-Tokens ein, 13.342 Bild-Tokens aus — gut 0,40 $.
        expect(openAiCost('gpt-image-2.5-flare', { textInput: 16, imageInput: 0, imageOutput: 13_342 })).toBeCloseTo(0.4003, 4);
    });

    it('liefert null für ein unbekanntes Modell', () => {
        // Lieber „unbekannt" anzeigen als eine erfundene Zahl.
        expect(openAiCost('gibt-es-nicht', { textInput: 100, imageInput: 0, imageOutput: 100 })).toBeNull();
    });

    it('kostet nichts, wenn nichts verbraucht wurde', () => {
        expect(openAiCost('gpt-image-2', { textInput: 0, imageInput: 0, imageOutput: 0 })).toBe(0);
    });

    it('rundet auf einen Zehntelcent', () => {
        const betrag = openAiCost('gpt-image-2', { textInput: 7, imageInput: 3, imageOutput: 11 });
        expect(betrag).not.toBeNull();
        // Darunter ist die Zahl Rauschen — vier Nachkommastellen genügen.
        expect(String(betrag).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(4);
    });
});
