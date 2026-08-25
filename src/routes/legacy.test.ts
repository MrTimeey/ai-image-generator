import { describe, expect, it } from 'vitest';
import { toModernBody } from './legacy';

/**
 * Die Übersetzung alter Aufrufe. Sie ist genau die Sorte Code, die bricht,
 * ohne dass es jemandem auffällt: die Skripte, die darauf angewiesen sind,
 * ruft niemand von Hand auf.
 */
describe('toModernBody', () => {
    it('macht aus `description` einen `prompt`', () => {
        expect(toModernBody({ description: 'ein Leuchtturm' }).prompt).toBe('ein Leuchtturm');
    });

    it('nimmt `prompt`, wenn der Aufruf schon neu ist', () => {
        expect(toModernBody({ prompt: 'ein Leuchtturm' }).prompt).toBe('ein Leuchtturm');
    });

    it('leitet die abgeschalteten DALL·E-Namen auf die Nachfolger um', () => {
        // dall-e-2 und dall-e-3 antworten seit dem 12.05.2026 mit 400.
        expect(toModernBody({ languageModel: 'DALL_E_THREE' }).model).toBe('gpt-image-2');
        expect(toModernBody({ languageModel: 'DALL_E_TWO' }).model).toBe('gpt-image-1-mini');
    });

    it('lässt aktuelle Modellnamen unverändert durch', () => {
        expect(toModernBody({ languageModel: 'flux-2-pro' }).model).toBe('flux-2-pro');
    });

    it('übersetzt die alten Größenbegriffe in Seitenverhältnisse', () => {
        expect(toModernBody({ size: 'LARGE_HORIZONTAL' }).ratio).toBe('16:9');
        expect(toModernBody({ size: 'LARGE_VERTICAL' }).ratio).toBe('9:16');
        expect(toModernBody({ size: 'LARGE' }).ratio).toBe('1:1');
        expect(toModernBody({ size: 'SMALL' }).ratio).toBe('1:1');
    });

    it('versteht die Größenbegriffe auch klein geschrieben', () => {
        expect(toModernBody({ size: 'large_horizontal' }).ratio).toBe('16:9');
    });

    it('nimmt ein bereits modernes Verhältnis direkt', () => {
        expect(toModernBody({ ratio: '21:9' }).ratio).toBe('21:9');
    });

    it('bevorzugt `ratio` vor `size`', () => {
        expect(toModernBody({ ratio: '3:2', size: 'LARGE_VERTICAL' }).ratio).toBe('3:2');
    });

    it('fällt auf 1:1 zurück, wenn nichts Brauchbares dabei ist', () => {
        expect(toModernBody({}).ratio).toBe('1:1');
        expect(toModernBody({ size: 'RIESIG' }).ratio).toBe('1:1');
    });

    it('übersetzt die alte Qualitätsskala', () => {
        expect(toModernBody({ quality: 'HD' }).quality).toBe('high');
        expect(toModernBody({ quality: 'STANDARD' }).quality).toBe('medium');
        expect(toModernBody({ quality: 'hd' }).quality).toBe('high');
    });

    it('lässt die neue Skala unverändert', () => {
        expect(toModernBody({ quality: 'low' }).quality).toBe('low');
    });

    /**
     * Wichtig: nicht gesetzte Felder müssen **fehlen**, nicht `undefined`
     * sein. Die Validierung mit Zod behandelt ein vorhandenes `undefined`
     * sonst als gesetzten Wert und weist den Aufruf ab.
     */
    it('lässt nicht gesetzte Felder ganz weg', () => {
        const uebersetzt = toModernBody({ description: 'x' });
        for (const feld of ['quality', 'outputFormat', 'amount', 'revisePrompt', 'seed', 'model']) {
            expect(uebersetzt).not.toHaveProperty(feld);
        }
        expect(Object.keys(uebersetzt).sort()).toEqual(['prompt', 'ratio']);
    });

    it('reicht die übrigen Felder unverändert weiter', () => {
        const uebersetzt = toModernBody({
            description: 'x',
            amount: 3,
            outputFormat: 'jpeg',
            revisePrompt: true,
            seed: 42,
        });
        expect(uebersetzt.amount).toBe(3);
        expect(uebersetzt.outputFormat).toBe('jpeg');
        expect(uebersetzt.revisePrompt).toBe(true);
        expect(uebersetzt.seed).toBe(42);
    });

    it('kommt mit einem leeren Rumpf zurecht', () => {
        expect(() => toModernBody({})).not.toThrow();
    });
});
