import { afterEach, describe, expect, it, vi } from 'vitest';
import axios, { AxiosError } from 'axios';
import { BflRequest, buildBody, isRetryableSubmitError, pollForResult, toProviderError } from './bflController';
import { ProviderError } from '../common/providerError';
import { findModel } from './modelRegistry';
import { resolveSize } from '../common/aspectRatio';
import { InputImage } from '../common/inputImage';

/** Eine Axios-Antwort, wie `toProviderError` sie liest — mehr braucht es nicht. */
const mitAntwort = (status: number, data: unknown = {}): AxiosError =>
    Object.assign(new AxiosError('Request failed with status code ' + status), {
        response: { status, data } as never,
    });

/**
 * Der `AggregateError`, den Node beim gescheiterten Verbindungsaufbau wirft:
 * **leere** Message, dafuer ein `code`. Hier nachgebaut statt direkt benutzt,
 * weil `AggregateError` erst ab `lib: ES2021` deklariert ist und das Projekt
 * auf ES2020 uebersetzt — fuer den geprueften Weg zaehlen nur diese zwei Felder.
 */
const ohneMeldung = (code?: string): Error => Object.assign(new Error(''), { errors: [], code });

describe('toProviderError', () => {
    /**
     * Der Fall vom 25.08.2026: `api.bfl.ai` loest dual-stack auf, der
     * Verbindungsaufbau scheitert auf allen Adressen, und Node wirft einen
     * `AggregateError` **ohne Message**, aber mit `code`. Vorher stand in der
     * Oberflaeche „bfl_submit_failed:" und nichts dahinter — das sah aus wie
     * ein Eingabefehler, war aber keiner.
     */
    it('nennt den Code, wenn der Fehler gar keine Meldung hat', () => {
        const fehler = toProviderError(ohneMeldung('ECONNREFUSED'), 'bfl_submit_failed');
        expect(fehler.message).not.toBe('');
        expect(fehler.message).toContain('ECONNREFUSED');
        expect(fehler.message).toContain('api.bfl.ai');
        expect(fehler.status).toBe(502);
    });

    it('kommt auch ohne Code mit einem ganzen Satz heraus', () => {
        const fehler = toProviderError(ohneMeldung(), 'bfl_submit_failed');
        expect(fehler.message).toContain('api.bfl.ai');
        expect(fehler.message).not.toContain('()');
    });

    it('reicht die Meldung des Anbieters durch, statt sie zu ersetzen', () => {
        const detail = [{ loc: ['body', 'input_image'], msg: 'value is not a valid image' }];
        const fehler = toProviderError(mitAntwort(422, { detail }), 'bfl_submit_failed');
        expect(fehler.status).toBe(422);
        expect(fehler.message).toContain('input_image');
        expect(fehler.message).not.toContain('kam nicht zustande');
    });

    /**
     * FastAPI echot das beanstandete Feld unter `input` zurueck — bei
     * `input_image` also das ganze Bild. Ungekuerzt stand das in der
     * Fehlermeldung und im Toast.
     */
    it('kuerzt eine Meldung, die das Referenzbild zurueckwirft', () => {
        const detail = [{ loc: ['body', 'input_image'], msg: 'invalid', input: 'A'.repeat(132_000) }];
        const fehler = toProviderError(mitAntwort(422, { detail }), 'bfl_submit_failed');
        expect(fehler.message.length).toBeLessThan(600);
        expect(fehler.message).toContain('input_image');
        expect(fehler.message).toContain('gekürzt');
    });

    it('laesst eine kurze Anbieter-Meldung unangetastet', () => {
        const detail = [{ loc: ['body', 'width'], msg: 'must be a multiple of 16' }];
        const fehler = toProviderError(mitAntwort(422, { detail }), 'bfl_submit_failed');
        expect(fehler.message).toBe(JSON.stringify(detail));
    });

    it('übersetzt „Insufficient credits" in einen verständlichen Satz', () => {
        const fehler = toProviderError(mitAntwort(402, { detail: 'Insufficient credits' }), 'bfl_submit_failed');
        expect(fehler.code).toBe('bfl_insufficient_credits');
        expect(fehler.status).toBe(402);
        expect(fehler.message).toContain('Guthaben');
    });

    it('laesst einen ProviderError unveraendert durch', () => {
        const eigener = new ProviderError(503, 'bfl_not_configured', 'Kein Schlüssel.');
        expect(toProviderError(eigener, 'bfl_submit_failed')).toBe(eigener);
    });
});

/**
 * Absenden darf nur wiederholt werden, wo feststeht, dass der Auftrag den
 * Anbieter nicht erreicht hat — sonst bezahlt der zweite Versuch dasselbe Bild
 * noch einmal.
 */
describe('isRetryableSubmitError', () => {
    it('wiederholt, wenn gar keine Antwort kam', () => {
        expect(isRetryableSubmitError(ohneMeldung('ECONNREFUSED'))).toBe(true);
        expect(isRetryableSubmitError(new AxiosError('timeout of 30000ms exceeded', 'ECONNABORTED'))).toBe(true);
    });

    it('wiederholt bei 429 — der Anbieter hat nichts verarbeitet', () => {
        expect(isRetryableSubmitError(mitAntwort(429))).toBe(true);
    });

    it('wiederholt nicht bei 4xx: die Eingabe wird beim zweiten Mal dieselbe sein', () => {
        expect(isRetryableSubmitError(mitAntwort(422))).toBe(false);
        expect(isRetryableSubmitError(mitAntwort(402))).toBe(false);
    });

    it('wiederholt nicht bei 5xx: der Auftrag kann angenommen und abgerechnet sein', () => {
        expect(isRetryableSubmitError(mitAntwort(500))).toBe(false);
        expect(isRetryableSubmitError(mitAntwort(503))).toBe(false);
    });

    it('wiederholt bei 503, wenn BFL ausdrücklich Last abwirft', () => {
        // Wörtlich so am 07.10.2026 von /v1/flux-3-image gekommen.
        const detail = '/v1/flux-3-image is over capacity and temporarily shedding requests. Please retry shortly.';
        expect(isRetryableSubmitError(mitAntwort(503, { detail }))).toBe(true);
        expect(isRetryableSubmitError(mitAntwort(503, { detail: 'internal error' }))).toBe(false);
    });

    it('wiederholt keinen eigenen ProviderError', () => {
        expect(isRetryableSubmitError(new ProviderError(502, 'bfl_no_polling_url', 'ohne URL'))).toBe(false);
    });
});

const bild = (base64: string): InputImage => ({ base64, buffer: Buffer.from(base64, 'base64'), mimeType: 'image/png' });

const anfrage = (modelId: string, mehr: Partial<BflRequest> = {}): BflRequest => {
    const model = findModel(modelId)!;
    return {
        prompt: 'A dome <dome_1>.',
        model,
        size: resolveSize(model, '16:9', 'high'),
        format: 'png',
        amount: 1,
        revisePrompt: false,
        inputImages: [],
        ...mehr,
    };
};

describe('buildBody', () => {
    /**
     * Das Schema von `/v1/flux-3-image` hat `additionalProperties: false`:
     * jedes Feld, das FLUX.2 kennt und FLUX 3 nicht, endet in einem 422.
     */
    it('schickt FLUX 3 nur Felder, die sein Schema kennt', () => {
        const body = buildBody(anfrage('flux-3-image', { revisePrompt: true }), 42);
        expect(Object.keys(body).sort()).toEqual(['aspect_ratio', 'grounding', 'prompt', 'resolution']);
        expect(body.aspect_ratio).toBe('16:9');
        expect(body.resolution).toBe('2k');
    });

    it('schaltet bei FLUX 3 die Websuche ab, solange niemand sie will', () => {
        // BFLs Standard ist `true` — unserer `false`: nur der eigene Prompt zählt.
        expect(buildBody(anfrage('flux-3-image')).grounding).toBe(false);
        expect(buildBody(anfrage('flux-3-image', { grounding: true })).grounding).toBe(true);
    });

    it('hängt das Layout als JSON an den Prompt', () => {
        const layout = [{ id: 'dome_1', bbox: [250, 150, 650, 850] as [number, number, number, number], desc: 'a dome' }];
        const body = buildBody(anfrage('flux-3-image', { layout }));
        expect(body.prompt).toBe('A dome <dome_1>. [{"id":"dome_1","bbox":[250,150,650,850],"desc":"a dome"}]');
    });

    it('gibt FLUX 3 die Referenzbilder als Liste `images`', () => {
        const body = buildBody(anfrage('flux-3-image', { inputImages: [bild('AAAA'), bild('BBBB')] }));
        expect(body.images).toEqual(['AAAA', 'BBBB']);
        expect(body).not.toHaveProperty('input_image');
    });

    it('lässt bei Bearbeitungen den Rahmen des Ausgangsbildes stehen', () => {
        expect(buildBody(anfrage('flux-3-image', { autoRatio: true })).aspect_ratio).toBe('auto');
    });

    it('lässt FLUX.2 bei `input_image`, `input_image_2`, …', () => {
        const body = buildBody(anfrage('flux-2-pro', { inputImages: [bild('AAAA'), bild('BBBB')] }), 7);
        expect(body.input_image).toBe('AAAA');
        expect(body.input_image_2).toBe('BBBB');
        expect(body).not.toHaveProperty('images');
        expect(body.seed).toBe(7);
        expect(body.prompt_upsampling).toBe(false);
        expect(body).not.toHaveProperty('grounding');
    });

    it('schickt Klein kein `prompt_upsampling` — Klein kann das nicht', () => {
        expect(buildBody(anfrage('flux-2-klein-9b', { revisePrompt: true }))).not.toHaveProperty('prompt_upsampling');
    });
});

describe('pollForResult', () => {
    afterEach(() => vi.restoreAllMocks());

    /**
     * Laut FLUX-3-Doku kommt ein gescheiterter Auftrag auch als HTTP 503 mit
     * normalem JSON-Body. Vorher wurde das sechsmal wiederholt und dann als
     * „bfl_poll_failed" gemeldet — die eigentliche Ursache ging verloren.
     */
    it('liest bei 503 erst den Status im Body', async () => {
        const get = vi.spyOn(axios, 'get').mockRejectedValue(mitAntwort(503, { status: 'Error', details: { reason: 'x' } }));
        await expect(pollForResult('https://example.invalid/poll')).rejects.toMatchObject({ code: 'bfl_error', status: 422 });
        expect(get).toHaveBeenCalledTimes(1);
    });

    it('wartet bei `Reasoning` weiter', async () => {
        vi.useFakeTimers();
        vi.spyOn(axios, 'get')
            .mockResolvedValueOnce({ data: { status: 'Reasoning' } })
            .mockResolvedValueOnce({ data: { status: 'Ready', result: { sample: 'https://x/y.png', prompt: 'lang' } } });
        const ergebnis = pollForResult('https://example.invalid/poll');
        await vi.runAllTimersAsync();
        await expect(ergebnis).resolves.toMatchObject({ url: 'https://x/y.png', revisedPrompt: 'lang' });
        vi.useRealTimers();
    });
});
