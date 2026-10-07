import { describe, expect, it } from 'vitest';
import { buildVideoBody, estimateUsd, expectedSeconds, keyframeErrors, mp4Seconds } from './videoService';
import { DataVideo } from '../common/videoStore';
import { VideoSchema } from '../routes/videos';

const video = (mehr: Partial<DataVideo> = {}): DataVideo => ({
    id: 'v1',
    createdAt: '2026-10-07_10-00',
    status: 'running',
    mode: 't2v',
    prompt: 'a fox running through dawn mist',
    draft: true,
    resolution: 'hd',
    aspectRatio: '16:9',
    duration: 5,
    generateAudio: true,
    startedAt: 0,
    ...mehr,
});

describe('keyframeErrors', () => {
    it('nimmt ein Startbild und ein Paar aus Anfang und Ende', () => {
        expect(keyframeErrors([{ image: 'a' }], 'auto')).toEqual([]);
        expect(keyframeErrors([{ image: 'a' }, { image: 'b' }], 'auto')).toEqual([]);
    });

    it('verlangt ab drei Bildern ohne Zeitpunkte eine feste Dauer', () => {
        const drei = [{ image: 'a' }, { image: 'b' }, { image: 'c' }];
        expect(keyframeErrors(drei, 'auto')[0]).toContain('feste Dauer');
        expect(keyframeErrors(drei, 10)).toEqual([]);
    });

    it('nimmt Zeitpunkte, wenn alle einen haben und sie aufsteigen', () => {
        expect(keyframeErrors([{ image: 'a', time: 0 }, { image: 'b', time: 3.5 }, { image: 'c', time: 8 }], 'auto')).toEqual([]);
    });

    it('weist gemischte Angaben ab', () => {
        expect(keyframeErrors([{ image: 'a', time: 0 }, { image: 'b' }], 'auto')[0]).toContain('alle');
    });

    it('weist absteigende oder doppelte Zeitpunkte ab', () => {
        expect(keyframeErrors([{ image: 'a', time: 4 }, { image: 'b', time: 2 }], 'auto')[0]).toContain('aufsteigen');
        expect(keyframeErrors([{ image: 'a', time: 2 }, { image: 'b', time: 2 }], 'auto')[0]).toContain('aufsteigen');
    });

    it('weist einen Zeitpunkt hinter dem Ende ab', () => {
        expect(keyframeErrors([{ image: 'a', time: 0 }, { image: 'b', time: 7 }], 5)[0]).toContain('hinter dem Ende');
    });

    it('nimmt höchstens zehn Bilder', () => {
        expect(keyframeErrors(Array(11).fill({ image: 'a' }), 20)[0]).toContain('Höchstens');
        expect(keyframeErrors([], 'auto')[0]).toContain('mindestens');
    });
});

describe('buildVideoBody', () => {
    /** Das Schema von /v1/flux-3-video verbietet unbekannte Felder — jedes zu viel ist ein 422. */
    it('schickt einen Entwurf ohne Auflösung — BFL lehnt draft plus Auflösung ab', () => {
        const body = buildVideoBody(video(), {});
        expect(body).toEqual({
            mode: 't2v',
            prompt: 'a fox running through dawn mist',
            aspect_ratio: '16:9',
            duration: 5,
            generate_audio: true,
            draft: true,
        });
    });

    it('schickt beim direkten Rendern die Auflösung statt `draft`', () => {
        const body = buildVideoBody(video({ draft: false, resolution: 'fhd' }), {});
        expect(body.resolution).toBe('fhd');
        expect(body).not.toHaveProperty('draft');
    });

    it('schickt Keyframes mit Zeitpunkten als [Sekunde, Bild]-Paare', () => {
        const body = buildVideoBody(video({ mode: 'i2v' }), {
            keyframes: [
                { base64: 'AAA', time: 0 },
                { base64: 'BBB', time: 4.5 },
            ],
        });
        // So am 07.10.2026 gesendet: Anfang bei 0 s, Ende bei 4,5 s — es lief.
        expect(body.keyframes).toEqual([
            [0, 'AAA'],
            [4.5, 'BBB'],
        ]);
    });

    it('schickt Keyframes ohne Zeitpunkte als schlichte Liste', () => {
        const body = buildVideoBody(video({ mode: 'i2v' }), { keyframes: [{ base64: 'AAA' }, { base64: 'BBB' }] });
        expect(body.keyframes).toEqual(['AAA', 'BBB']);
    });

    it('schickt beim Fortsetzen das Startvideo', () => {
        const body = buildVideoBody(video({ mode: 'v2v' }), { startVideo: 'MP4' });
        expect(body.start_video).toBe('MP4');
        expect(body).not.toHaveProperty('keyframes');
    });

    it('schickt beim Fertigrendern nur Bündel und Auflösung', () => {
        const body = buildVideoBody(video({ mode: 'draft_enhance', draft: false, resolution: 'uhd' }), { draftCache: 'BIN' });
        expect(body).toEqual({ mode: 'draft_enhance', draft_cache: 'BIN', resolution: 'uhd' });
    });
});

describe('Preise', () => {
    it('rechnet je Sekunde', () => {
        // Gemessen am 07.10.2026: 5 s Entwurf = 30 Credits = 0,30 $.
        expect(estimateUsd('i2v', 'hd', true, 5)).toBe(0.3);
        expect(estimateUsd('t2v', 'fhd', false, 10)).toBe(2.9);
        expect(estimateUsd('v2v', 'uhd', false, 15)).toBe(14.25);
    });

    it('schätzt die Länge aus dem letzten Zeitpunkt, aufgerundet', () => {
        expect(expectedSeconds('auto', [{ image: 'a', time: 0 }, { image: 'b', time: 7.2 }])).toBe(8);
        expect(expectedSeconds(12)).toBe(12);
    });
});

describe('mp4Seconds', () => {
    it('liest die Laufzeit aus dem mvhd-Atom', () => {
        // Die Bytes des Entwurfs vom 07.10.2026: timescale 1000, Dauer 5042.
        const kopf = Buffer.from('0000006c6d766864000000000000000000000000000003e8000013b200010000', 'hex');
        expect(mp4Seconds(Buffer.concat([Buffer.alloc(40), kopf, Buffer.alloc(80)]))).toBe(5.04);
    });

    it('gibt ohne mvhd nichts zurück', () => {
        expect(mp4Seconds(Buffer.from('kein video'))).toBeUndefined();
    });
});

describe('VideoSchema', () => {
    it('setzt die vorsichtigen Standards: Entwurf, Ton an, Dauer auto', () => {
        const parsed = VideoSchema.parse({ mode: 't2v', prompt: 'x' });
        expect(parsed).toMatchObject({ draft: true, generateAudio: true, duration: 'auto', aspectRatio: 'auto' });
    });

    it('weist 3:2 ab — das Video kennt es nicht', () => {
        expect(VideoSchema.safeParse({ mode: 't2v', prompt: 'x', aspectRatio: '3:2' }).success).toBe(false);
    });

    it('weist eine Dauer unter fünf Sekunden ab', () => {
        expect(VideoSchema.safeParse({ mode: 't2v', prompt: 'x', duration: 3 }).success).toBe(false);
    });
});

describe('ENABLED_MODES', () => {
    it('bietet Fortsetzen vorerst nicht an — es scheiterte ungeklärt an „Insufficient credits"', async () => {
        const { ENABLED_MODES } = await import('./videoService');
        expect(ENABLED_MODES).toEqual(['t2v', 'i2v']);
    });
});
