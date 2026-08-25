import { DataImage, Sorting } from '../types';
import { getDataStore } from './dataStore';
import { fromFormated } from './timeUtils';

/**
 * Suchen, filtern, sortieren, blättern — bewusst als reine Funktion über einer
 * übergebenen Liste, ohne Dateizugriff. Dadurch ist sie ohne Aufbauten
 * testbar, und die beiden Endpunkte (`/api/images` und der alte
 * `/api/thumbnails/all`) teilen sich dieselbe Reihenfolge.
 */
export type ImageQuery = {
    q?: string;
    model?: string;
    provider?: string;
    ratio?: string;
    favorite?: boolean;
    sorting?: Sorting;
    limit?: number;
    cursor?: string;
};

export type ImageSummary = {
    fileName: string;
    createdAt: string;
    prompt: string;
    revisedPrompt: string;
    model: string;
    provider: string;
    ratio: string;
    width?: number;
    height?: number;
    favorite: boolean;
    hasReferences: boolean;
};

export type ImageListing = {
    images: ImageSummary[];
    nextCursor: string | null;
    total: number;
};

/** Sortierschlüssel. Einmal je Eintrag berechnet, nicht je Vergleich. */
const sortKey = (entry: DataImage | undefined): number => {
    if (!entry?.createdAt) return 0;
    const parsed = fromFormated(entry.createdAt);
    const value = parsed.valueOf();
    return Number.isNaN(value) ? 0 : value;
};

const summary = (fileName: string, entry: DataImage | undefined): ImageSummary => ({
    fileName,
    createdAt: entry?.createdAt ?? '',
    prompt: entry?.description ?? '',
    revisedPrompt: entry?.revisedPrompt ?? '',
    model: entry?.model ?? entry?.languageModel ?? '',
    provider: entry?.provider ?? '',
    ratio: entry?.ratio ?? '',
    width: entry?.width,
    height: entry?.height,
    favorite: entry?.favorite === true,
    hasReferences: (entry?.referenceImages?.length ?? 0) > 0,
});

const matches = (image: ImageSummary, query: ImageQuery): boolean => {
    if (query.model && image.model !== query.model) return false;
    if (query.provider && image.provider !== query.provider) return false;
    if (query.ratio && image.ratio !== query.ratio) return false;
    if (query.favorite && !image.favorite) return false;
    if (query.q) {
        const needle = query.q.toLowerCase();
        const haystack = `${image.prompt} ${image.revisedPrompt} ${image.model}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
    }
    return true;
};

export const listImages = (query: ImageQuery, fileNames: string[]): ImageListing => {
    const byName = new Map(getDataStore().data.filter(e => e.fileName).map(e => [e.fileName as string, e]));

    /**
     * Decorate–sort–undecorate: der Schlüssel wird einmal je Eintrag berechnet.
     * Der frühere Komparator parste zweimal **pro Vergleich** mit dayjs und war
     * obendrein nicht transitiv (`return -1` in beide Richtungen), sodass
     * Einträge ohne Datum die Reihenfolge dem Zufall überliessen.
     */
    const decorated = fileNames.map(fileName => {
        const entry = byName.get(fileName);
        return { image: summary(fileName, entry), key: sortKey(entry) };
    });

    const descending = query.sorting === Sorting.DESCENDING;
    decorated.sort((a, b) => (a.key - b.key || a.image.fileName.localeCompare(b.image.fileName)) * (descending ? -1 : 1));

    const gefiltert = decorated.map(d => d.image).filter(image => matches(image, query));

    // Cursor ist der Dateiname des zuletzt gelieferten Bildes — stabil auch
    // dann, wenn zwischendurch etwas gelöscht wird.
    const start = query.cursor ? gefiltert.findIndex(image => image.fileName === query.cursor) + 1 : 0;
    // Die Obergrenze schuetzt `/api/images` vor riesigen Antworten; der
    // Alt-Endpunkt reicht bewusst die Gesamtzahl herein und darf darueber.
    const limit = Math.max(query.limit ?? 100, 1);
    const seite = gefiltert.slice(start, start + limit);
    const nextCursor = start + limit < gefiltert.length ? seite[seite.length - 1]?.fileName ?? null : null;

    return { images: seite, nextCursor, total: gefiltert.length };
};
