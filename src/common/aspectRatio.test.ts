import { describe, expect, it } from 'vitest';
import { clampQuality, resolveSize } from './aspectRatio';
import { findModel, ModelDefinition } from '../controller/modelRegistry';
import { AspectRatio, ASPECT_RATIOS } from '../types';

const modell = (id: string): ModelDefinition => {
    const gefunden = findModel(id);
    if (!gefunden) throw new Error(`Modell ${id} fehlt in der Registry`);
    return gefunden;
};

/** Wie weit das Ergebnis vom bestellten Verhältnis abweicht, in Prozent. */
const abweichung = (breite: number, hoehe: number, ratio: AspectRatio): number => {
    const [w, h] = ratio.split(':').map(Number);
    return Math.abs(breite / hoehe - w / h) / (w / h) * 100;
};

describe('resolveSize — width_height (FLUX.2)', () => {
    const flux = modell('flux-2-pro');

    it.each(ASPECT_RATIOS)('trifft %s auf unter 3 %% genau', ratio => {
        const { width, height } = resolveSize(flux, ratio, 'medium');
        expect(abweichung(width, height, ratio)).toBeLessThan(3);
    });

    it('rastert die Kanten auf Vielfache von 16', () => {
        for (const ratio of ASPECT_RATIOS) {
            const { width, height } = resolveSize(flux, ratio, 'high');
            expect(width % 16).toBe(0);
            expect(height % 16).toBe(0);
        }
    });

    /**
     * Bei FLUX.2 zählt die **Fläche**, nicht die einzelne Kante: 3040×1360
     * wird angenommen, 3072×1728 nicht. Die Grenze liegt bei 4.194.304 Pixeln
     * — wer sie überschreitet, bekommt den ganzen Auftrag abgelehnt.
     */
    it('bleibt in den Grenzen des Modells', () => {
        for (const stufe of ['low', 'medium', 'high'] as const) {
            for (const ratio of ASPECT_RATIOS) {
                const { width, height } = resolveSize(flux, ratio, stufe);
                expect(width).toBeGreaterThanOrEqual(256);
                expect(height).toBeGreaterThanOrEqual(256);
                expect(width * height).toBeLessThanOrEqual(4_194_304);
            }
        }
    });

    it('bietet keine `max`-Stufe an, weil `high` dort schon am Limit ist', () => {
        // Fünf Prozent mehr wären ein Versprechen, das die Stufe nicht hält.
        expect(flux.qualities).not.toContain('max');
        const hoch = resolveSize(flux, '16:9', 'high');
        expect(hoch.width * hoch.height).toBeGreaterThan(3_900_000);
    });

    it('liefert für höhere Stufen mehr Pixel', () => {
        const klein = resolveSize(flux, '1:1', 'low');
        const gross = resolveSize(flux, '1:1', 'high');
        expect(gross.width * gross.height).toBeGreaterThan(klein.width * klein.height);
    });

    it('spiegelt Hoch- und Querformat', () => {
        const quer = resolveSize(flux, '16:9', 'medium');
        const hoch = resolveSize(flux, '9:16', 'medium');
        expect(hoch.width).toBe(quer.height);
        expect(hoch.height).toBe(quer.width);
    });
});

describe('resolveSize — width_height mit engen Grenzen (flux-pro-1.1)', () => {
    const alt = modell('flux-pro-1.1');

    it('hält die Obergrenze von 1440 auch bei extremen Verhältnissen ein', () => {
        // 21:9 sprengt bei 2 Megapixeln die längere Kante — hier muss geklemmt
        // werden, und die kurze Kante dem Verhältnis folgen.
        const { width, height } = resolveSize(alt, '21:9', 'medium');
        expect(width).toBeLessThanOrEqual(1440);
        expect(height).toBeLessThanOrEqual(1440);
        expect(abweichung(width, height, '21:9')).toBeLessThan(5);
    });

    it('rastert auf Vielfache von 32', () => {
        for (const ratio of ASPECT_RATIOS) {
            const { width, height } = resolveSize(alt, ratio, 'low');
            expect(width % 32).toBe(0);
            expect(height % 32).toBe(0);
        }
    });
});

describe('resolveSize — pixel_size (OpenAI)', () => {
    it('kommt bei gpt-image-2 mit `max` auf 4K-Format', () => {
        const { width, height, size } = resolveSize(modell('gpt-image-2'), '16:9', 'max');
        // 8.294.400 Pixel sind erlaubt; 3840×2160 ist genau das.
        expect(width * height).toBeLessThanOrEqual(8_294_400);
        expect(width * height).toBeGreaterThan(8_294_400 * 0.9);
        expect(width).toBeLessThanOrEqual(3840);
        expect(size).toBe(`${width}x${height}`);
    });

    it('gibt bei gpt-image-2 einen size-String mit Vielfachen von 16', () => {
        const { size, width, height } = resolveSize(modell('gpt-image-2'), '16:9', 'medium');
        expect(size).toBe(`${width}x${height}`);
        expect(width % 16).toBe(0);
        expect(height % 16).toBe(0);
    });

    it('rastet bei festen Größen auf die nächstliegende ein', () => {
        const mini = modell('gpt-image-1-mini');
        expect(resolveSize(mini, '1:1', 'low').size).toBe('1024x1024');
        expect(resolveSize(mini, '3:2', 'low').size).toBe('1536x1024');
        expect(resolveSize(mini, '2:3', 'low').size).toBe('1024x1536');
    });

    it('gibt bei festen Größen nie etwas anderes zurück als die drei erlaubten', () => {
        const erlaubt = ['1024x1024', '1536x1024', '1024x1536'];
        for (const ratio of modell('gpt-image-1.5').ratios) {
            expect(erlaubt).toContain(resolveSize(modell('gpt-image-1.5'), ratio, 'high').size);
        }
    });
});

describe('resolveSize — aspect_ratio (Kontext)', () => {
    it('reicht das Verhältnis unverändert durch', () => {
        const { aspectRatio, size } = resolveSize(modell('flux-kontext-pro'), '3:4', 'medium');
        expect(aspectRatio).toBe('3:4');
        // Kein size-String: dort bestimmt der Anbieter die Kanten.
        expect(size).toBeUndefined();
    });
});

describe('clampQuality', () => {
    it('behält eine unterstützte Stufe', () => {
        expect(clampQuality(modell('flux-2-pro'), 'high')).toBe('high');
    });

    it('geht auf die nächstniedrigere, wenn die Stufe fehlt', () => {
        // flux-pro-1.1 kennt nur low und medium.
        expect(clampQuality(modell('flux-pro-1.1'), 'high')).toBe('medium');
    });

    it('liefert medium, wenn das Modell gar keine Stufen kennt', () => {
        expect(clampQuality(modell('flux-kontext-pro'), 'high')).toBe('medium');
    });

    it('nimmt medium als Standard, wenn nichts gewählt wurde', () => {
        expect(clampQuality(modell('flux-2-pro'), undefined)).toBe('medium');
    });
});
