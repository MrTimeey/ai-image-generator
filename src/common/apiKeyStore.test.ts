import { describe, expect, it } from 'vitest';
import { isExpired } from './apiKeyStore';

/**
 * Ein abgelaufener Schlüssel muss abgewiesen werden wie ein unbekannter.
 * Die Grenze läuft mitten durch den laufenden Betrieb, deshalb steht sie hier
 * ausdrücklich fest.
 */
describe('isExpired', () => {
    const jetzt = Date.parse('2026-08-25T12:00:00Z');

    it('gilt unbegrenzt, wenn kein Ablauf gesetzt ist', () => {
        expect(isExpired({}, jetzt)).toBe(false);
        expect(isExpired({ expiresAt: undefined }, jetzt)).toBe(false);
    });

    it('ist abgelaufen, wenn der Zeitpunkt vorbei ist', () => {
        expect(isExpired({ expiresAt: '2026-08-25T11:59:59Z' }, jetzt)).toBe(true);
        expect(isExpired({ expiresAt: '2020-01-01T00:00:00Z' }, jetzt)).toBe(true);
    });

    it('ist noch gültig, solange der Zeitpunkt in der Zukunft liegt', () => {
        expect(isExpired({ expiresAt: '2026-08-25T12:00:01Z' }, jetzt)).toBe(false);
        expect(isExpired({ expiresAt: '2027-01-01T00:00:00Z' }, jetzt)).toBe(false);
    });

    it('zählt den Ablaufzeitpunkt selbst als abgelaufen', () => {
        // Punktgenau gleich heißt vorbei — sonst wäre die letzte Sekunde
        // eine Grauzone.
        expect(isExpired({ expiresAt: '2026-08-25T12:00:00Z' }, jetzt)).toBe(true);
    });
});
