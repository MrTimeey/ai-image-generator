import { describe, expect, it } from 'vitest';
import { AxiosError } from 'axios';
import { isRetryableSubmitError, toProviderError } from './bflController';
import { ProviderError } from '../common/providerError';

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

    it('wiederholt keinen eigenen ProviderError', () => {
        expect(isRetryableSubmitError(new ProviderError(502, 'bfl_no_polling_url', 'ohne URL'))).toBe(false);
    });
});
