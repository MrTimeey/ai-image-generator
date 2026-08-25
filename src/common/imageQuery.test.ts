import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataImage, ImageDataStore, Sorting } from '../types';
import { listImages } from './imageQuery';

/**
 * `listImages` liest den Bestand über `getDataStore`. Der Store wird hier
 * ersetzt, damit die Tests ohne Dateien auskommen — geprüft wird die Logik:
 * Reihenfolge, Suche, Filter und das Blättern.
 */
// `vi.hoisted`, weil `vi.mock` über die Imports gezogen wird: eine gewöhnliche
// Variable wäre zum Zeitpunkt der Factory noch nicht initialisiert.
const bestand = vi.hoisted(() => ({ store: { entries: 0, data: [] } as ImageDataStore }));

vi.mock('./dataStore', () => ({
    getDataStore: () => bestand.store,
}));

const eintrag = (over: Partial<DataImage> & { fileName: string }): DataImage => ({
    id: over.fileName,
    createdAt: '2026-01-01_10-00',
    description: '',
    revisedPrompt: '',
    ...over,
});

const setze = (eintraege: DataImage[]) => {
    bestand.store = { entries: eintraege.length, data: eintraege };
};

const namen = (eintraege: DataImage[]) => eintraege.map(e => e.fileName as string);

beforeEach(() => setze([]));

describe('Reihenfolge', () => {
    const drei = [
        eintrag({ fileName: 'alt.png', createdAt: '2026-01-01_08-00' }),
        eintrag({ fileName: 'mittel.png', createdAt: '2026-05-05_12-00' }),
        eintrag({ fileName: 'neu.png', createdAt: '2026-08-25_18-00' }),
    ];

    it('sortiert absteigend: neueste zuerst', () => {
        setze(drei);
        const { images } = listImages({ sorting: Sorting.DESCENDING }, namen(drei));
        expect(images.map(i => i.fileName)).toEqual(['neu.png', 'mittel.png', 'alt.png']);
    });

    it('sortiert aufsteigend: älteste zuerst', () => {
        setze(drei);
        const { images } = listImages({ sorting: Sorting.ASCENDING }, namen(drei));
        expect(images.map(i => i.fileName)).toEqual(['alt.png', 'mittel.png', 'neu.png']);
    });

    /**
     * Der frühere Komparator gab in beiden Richtungen `-1` zurück, sobald ein
     * Datum fehlte. Damit war er nicht transitiv, und die Reihenfolge hing von
     * der Sortiermethode der Engine ab — bei importierten oder alten Daten
     * also vom Zufall.
     */
    it('bleibt stabil, wenn Einträge ohne Datum dabei sind', () => {
        const gemischt = [
            eintrag({ fileName: 'a.png', createdAt: '2026-03-03_10-00' }),
            eintrag({ fileName: 'ohne1.png', createdAt: '' }),
            eintrag({ fileName: 'b.png', createdAt: '2026-04-04_10-00' }),
            eintrag({ fileName: 'ohne2.png', createdAt: '' }),
        ];
        setze(gemischt);

        const einmal = listImages({ sorting: Sorting.DESCENDING }, namen(gemischt)).images.map(i => i.fileName);
        // Dieselbe Eingabe in anderer Reihenfolge muss dasselbe Ergebnis liefern.
        const andersherum = listImages(
            { sorting: Sorting.DESCENDING },
            [...namen(gemischt)].reverse()
        ).images.map(i => i.fileName);

        expect(andersherum).toEqual(einmal);
        expect(einmal).toHaveLength(4);
    });

    it('nimmt Dateien ohne Eintrag mit, statt sie zu verschlucken', () => {
        setze([eintrag({ fileName: 'bekannt.png' })]);
        const { images, total } = listImages({}, ['bekannt.png', 'fremd.png']);
        expect(total).toBe(2);
        expect(images.find(i => i.fileName === 'fremd.png')?.prompt).toBe('');
    });
});

describe('Suche', () => {
    beforeEach(() => {
        setze([
            eintrag({ fileName: 'a.png', description: 'Ein Leuchtturm bei Sonnenuntergang' }),
            eintrag({ fileName: 'b.png', description: 'ein roter Würfel', revisedPrompt: 'a red cube on white' }),
            eintrag({ fileName: 'c.png', description: 'Katze auf dem Sofa', model: 'gpt-image-2' }),
        ]);
    });

    const suche = (q: string) => listImages({ q }, ['a.png', 'b.png', 'c.png']).images.map(i => i.fileName);

    it('findet im Prompt, unabhängig von Groß- und Kleinschreibung', () => {
        expect(suche('leuchtturm')).toEqual(['a.png']);
        expect(suche('LEUCHTTURM')).toEqual(['a.png']);
    });

    it('findet auch im revidierten Prompt', () => {
        // Der umgeschriebene Prompt ist oft englisch — wer danach sucht, soll
        // ihn finden, auch wenn die eigene Eingabe deutsch war.
        expect(suche('red cube')).toEqual(['b.png']);
    });

    it('findet über den Modellnamen', () => {
        expect(suche('gpt-image')).toEqual(['c.png']);
    });

    it('liefert nichts bei einem Begriff, den es nicht gibt', () => {
        expect(suche('nashorn')).toEqual([]);
    });
});

describe('Filter', () => {
    const alle = ['a.png', 'b.png', 'c.png'];
    beforeEach(() => {
        setze([
            eintrag({ fileName: 'a.png', model: 'flux-2-pro', provider: 'bfl', ratio: '16:9', favorite: true }),
            eintrag({ fileName: 'b.png', model: 'gpt-image-2', provider: 'openai', ratio: '1:1' }),
            eintrag({ fileName: 'c.png', model: 'flux-2-pro', provider: 'bfl', ratio: '1:1' }),
        ]);
    });

    it('filtert nach Modell', () => {
        expect(listImages({ model: 'flux-2-pro' }, alle).total).toBe(2);
    });

    it('filtert nach Anbieter', () => {
        expect(listImages({ provider: 'openai' }, alle).total).toBe(1);
    });

    it('filtert nach Seitenverhältnis', () => {
        expect(listImages({ ratio: '1:1' }, alle).total).toBe(2);
    });

    it('filtert nach Favoriten', () => {
        expect(listImages({ favorite: true }, alle).images.map(i => i.fileName)).toEqual(['a.png']);
    });

    it('kombiniert Filter mit und', () => {
        expect(listImages({ model: 'flux-2-pro', ratio: '1:1' }, alle).total).toBe(1);
    });

    it('zählt in `total` die gefilterte Menge, nicht den ganzen Bestand', () => {
        const { total, images } = listImages({ model: 'flux-2-pro', limit: 1 }, alle);
        expect(total).toBe(2);
        expect(images).toHaveLength(1);
    });
});

describe('Blättern', () => {
    const viele = Array.from({ length: 25 }, (_, i) =>
        eintrag({ fileName: `bild-${String(i).padStart(2, '0')}.png`, createdAt: `2026-01-${String(i + 1).padStart(2, '0')}_10-00` })
    );

    beforeEach(() => setze(viele));

    it('liefert höchstens `limit` Einträge und einen Cursor', () => {
        const seite = listImages({ limit: 10 }, namen(viele));
        expect(seite.images).toHaveLength(10);
        expect(seite.nextCursor).toBe(seite.images[9].fileName);
        expect(seite.total).toBe(25);
    });

    it('führt über alle Seiten genau einmal durch den Bestand', () => {
        const gesehen: string[] = [];
        let cursor: string | null = null;
        for (let i = 0; i < 10; i++) {
            const seite = listImages({ limit: 10, cursor: cursor ?? undefined }, namen(viele));
            gesehen.push(...seite.images.map(i => i.fileName));
            cursor = seite.nextCursor;
            if (!cursor) break;
        }
        expect(gesehen).toHaveLength(25);
        expect(new Set(gesehen).size).toBe(25);
    });

    it('gibt am Ende keinen Cursor mehr aus', () => {
        expect(listImages({ limit: 100 }, namen(viele)).nextCursor).toBeNull();
    });

    it('beginnt von vorn, wenn der Cursor unbekannt ist', () => {
        // Etwa wenn das Bild inzwischen gelöscht wurde: lieber die erste Seite
        // als eine leere Antwort.
        const seite = listImages({ limit: 5, cursor: 'gibt-es-nicht.png' }, namen(viele));
        expect(seite.images).toHaveLength(5);
    });
});
