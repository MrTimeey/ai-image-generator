import { describe, expect, it } from 'vitest';
import { GenerateSchema, MAX_INPUT_IMAGES } from './generate';
import { MODELS } from '../controller/modelRegistry';

describe('GenerateSchema', () => {
    it('lässt so viele Referenzbilder durch, wie das großzügigste Modell nimmt', () => {
        const meisteBilder = Math.max(...MODELS.map(model => model.maxInputImages));
        expect(MAX_INPUT_IMAGES).toBe(meisteBilder);
        const parsed = GenerateSchema.safeParse({ prompt: 'x', inputImages: Array(meisteBilder).fill('abc') });
        expect(parsed.success).toBe(true);
    });

    it('nimmt GPT Image 2.5 seine 16 Referenzbilder ab', () => {
        const parsed = GenerateSchema.safeParse({
            prompt: 'x',
            model: 'gpt-image-2.5-flare',
            inputImages: Array(16).fill('abc'),
        });
        expect(parsed.success).toBe(true);
    });

    it('weist mehr Bilder ab, als irgendein Modell nimmt', () => {
        const parsed = GenerateSchema.safeParse({ prompt: 'x', inputImages: Array(MAX_INPUT_IMAGES + 1).fill('abc') });
        expect(parsed.success).toBe(false);
    });
});
