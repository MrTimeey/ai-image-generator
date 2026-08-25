import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { failJob, finishJob, getJob, isValidJobId, startJob } from './jobStore';
import { GenerationResult } from '../types';

const ergebnis = (): GenerationResult => ({
    createdAt: '2026-08-25_10-00',
    model: 'flux-2-pro',
    provider: 'bfl',
    description: 'test',
    width: 1024,
    height: 1024,
    images: [],
    errors: [],
});

describe('isValidJobId', () => {
    it('nimmt Kennungen an, wie der Client sie erzeugt', () => {
        expect(isValidJobId('abcdef1234567890')).toBe(true);
        expect(isValidJobId('mit-Strich_und_Unterstrich')).toBe(true);
    });

    it.each([
        ['kurz', 'unter acht Zeichen'],
        ['a'.repeat(65), 'über 64 Zeichen'],
        ['mit/schrägstrich123', 'Pfadtrenner'],
        ['../../etc/passwd', 'Verzeichniswechsel'],
        ['mit leerzeichen1', 'Leerzeichen'],
        ['', 'leer'],
    ])('weist %s ab (%s)', eingabe => {
        expect(isValidJobId(eingabe)).toBe(false);
    });

    it('weist alles ab, was kein String ist', () => {
        for (const wert of [null, undefined, 42, {}, []]) {
            expect(isValidJobId(wert)).toBe(false);
        }
    });
});

describe('Lebenslauf eines Auftrags', () => {
    it('geht von running nach done', () => {
        startJob('auftrag-eins-12345');
        expect(getJob('auftrag-eins-12345')?.status).toBe('running');

        finishJob('auftrag-eins-12345', ergebnis());
        const fertig = getJob('auftrag-eins-12345');
        expect(fertig?.status).toBe('done');
        expect(fertig?.status === 'done' && fertig.result.model).toBe('flux-2-pro');
    });

    it('geht von running nach error und behält den Code', () => {
        startJob('auftrag-zwei-12345');
        failJob('auftrag-zwei-12345', 'bfl_content_moderated', 'Der Prompt wurde abgelehnt.');
        const kaputt = getJob('auftrag-zwei-12345');
        expect(kaputt?.status).toBe('error');
        expect(kaputt?.status === 'error' && kaputt.code).toBe('bfl_content_moderated');
    });

    it('kennt einen nie gestarteten Auftrag nicht', () => {
        expect(getJob('nie-gestartet-123')).toBeUndefined();
    });

    /**
     * Der Fall, für den es den Store überhaupt gibt: die Verbindung reißt ab,
     * bevor die Antwort ankommt. Das Ergebnis wird trotzdem abgelegt und muss
     * danach abholbar sein.
     */
    it('nimmt ein Ergebnis auch ohne vorheriges startJob an', () => {
        finishJob('ohne-start-12345', ergebnis());
        expect(getJob('ohne-start-12345')?.status).toBe('done');
    });
});

describe('Aufräumen', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('vergisst Aufträge, die älter als eine halbe Stunde sind', () => {
        vi.setSystemTime(new Date('2026-08-25T10:00:00Z'));
        startJob('alter-auftrag-123');
        finishJob('alter-auftrag-123', ergebnis());
        expect(getJob('alter-auftrag-123')?.status).toBe('done');

        // 31 Minuten später — und ein neuer Auftrag stößt das Aufräumen an.
        vi.setSystemTime(new Date('2026-08-25T10:31:00Z'));
        startJob('neuer-auftrag-123');

        expect(getJob('alter-auftrag-123')).toBeUndefined();
        expect(getJob('neuer-auftrag-123')?.status).toBe('running');
    });

    it('behält Aufträge innerhalb der Frist', () => {
        vi.setSystemTime(new Date('2026-08-25T12:00:00Z'));
        startJob('frischer-auftrag-1');
        finishJob('frischer-auftrag-1', ergebnis());

        vi.setSystemTime(new Date('2026-08-25T12:20:00Z'));
        startJob('noch-einer-123456');

        expect(getJob('frischer-auftrag-1')?.status).toBe('done');
    });

    it('wächst nicht unbegrenzt', () => {
        vi.setSystemTime(new Date('2026-08-25T14:00:00Z'));
        for (let i = 0; i < 250; i++) {
            startJob(`massenauftrag-${String(i).padStart(6, '0')}`);
        }
        // Die ältesten fallen heraus, die jüngsten bleiben.
        expect(getJob('massenauftrag-000000')).toBeUndefined();
        expect(getJob('massenauftrag-000249')?.status).toBe('running');
    });
});
