import fs from 'fs';
import path from 'node:path';
import { DataImage, ImageDataStore } from '../types';
import appConfig from './appConfig';
import { bigThumbnailDir } from '../routes/files';
import { thumbnailDir } from '../routes/thumbnails';
import { isImageFile, REFERENCE_DIR } from './fileUtils';

const dataStoreName = 'data.json';

const storePath = (): string => path.join(appConfig.baseFolder, dataStoreName);

/**
 * Der Bestand liegt **im Speicher**, `data.json` ist die Wahrheit auf der
 * Platte. Bei inzwischen über 800 Einträgen sind das gut 1,2 MB, die vorher
 * bei *jedem* Zugriff neu geparst wurden — auch für die Detailansicht eines
 * einzelnen Bildes. Ein paar Megabyte Speicher sind dafür der bessere Handel;
 * der Container nutzt knapp 300 MB von 11 GB.
 */
let cache: ImageDataStore | null = null;
/** Zeigt vom Dateinamen auf den Eintrag — spart die Linearsuche. */
let index: Map<string, DataImage> = new Map();

const buildIndex = (store: ImageDataStore): Map<string, DataImage> => {
    const map = new Map<string, DataImage>();
    for (const entry of store.data) {
        if (entry.fileName) map.set(entry.fileName, entry);
    }
    return map;
};

const emptyStore = (): ImageDataStore => ({ entries: 0, data: [] });

/**
 * Liest die Datei. Eine unlesbare `data.json` wird **beiseitegelegt statt
 * weggeworfen**: vorher warf `JSON.parse` ungefangen, und weil
 * `cleanDataStore` beim Start läuft, kam die Anwendung damit gar nicht mehr
 * hoch — mit einer kaputten Datei als einzigem Hinweis.
 */
const readFromDisk = (): ImageDataStore => {
    const file = storePath();
    if (!fs.existsSync(file)) return emptyStore();
    try {
        const parsed = JSON.parse(fs.readFileSync(file, { encoding: 'utf8' })) as ImageDataStore;
        if (!Array.isArray(parsed?.data)) throw new Error('Feld `data` fehlt oder ist kein Array');
        return { entries: parsed.data.length, data: parsed.data };
    } catch (error) {
        const broken = `${file}.kaputt-${Date.now()}`;
        try {
            fs.renameSync(file, broken);
            console.error(`data.json ist unlesbar (${error}). Beiseitegelegt als ${broken}; starte mit leerem Bestand.`);
        } catch (renameError) {
            console.error(`data.json ist unlesbar (${error}) und liess sich nicht umbenennen: ${renameError}`);
        }
        return emptyStore();
    }
};

export const getDataStore = (): ImageDataStore => {
    if (!cache) {
        cache = readFromDisk();
        index = buildIndex(cache);
    }
    return cache;
};

/** Ein einzelner Eintrag über den Index statt über eine Linearsuche. */
export const findEntry = (fileName: string): DataImage | undefined => {
    getDataStore();
    return index.get(fileName);
};

export const getDataStoreFromPath = (folder: string): ImageDataStore => {
    // Vorher wurde das **Verzeichnis** geprüft, gelesen aber die Datei darin —
    // ein Archiv ohne data.json scheiterte deshalb mit ENOENT.
    const file = path.join(folder, dataStoreName);
    if (!fs.existsSync(file)) return emptyStore();
    try {
        const parsed = JSON.parse(fs.readFileSync(file, { encoding: 'utf8' })) as ImageDataStore;
        if (!Array.isArray(parsed?.data)) return emptyStore();
        return { entries: parsed.data.length, data: parsed.data };
    } catch (error) {
        console.error('data.json im Archiv ist unlesbar:', error);
        return emptyStore();
    }
};

export const getImageMap = (dataStore: ImageDataStore): { [key: string]: DataImage } => {
    // Zuweisen statt `{ ...acc }` je Schritt: das war bei 800 Einträgen eine
    // sechsstellige Zahl an Property-Kopien pro Aufruf.
    const map: { [key: string]: DataImage } = {};
    for (const entry of dataStore.data) {
        if (entry.fileName) map[entry.fileName] = entry;
    }
    return map;
};

export const saveDataStore = (store: ImageDataStore): void => {
    if (!fs.existsSync(appConfig.baseFolder)) {
        fs.mkdirSync(appConfig.baseFolder, { recursive: true });
    }
    store.entries = store.data.length;

    // Erst daneben schreiben, dann umbenennen. Ein Container-Stop mitten im
    // Schreiben — also jedes Deployment während einer Generierung — hinterliess
    // sonst eine halbe Datei und damit den gesamten Bestand an Prompts.
    const file = storePath();
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), { encoding: 'utf8' });
    fs.renameSync(tmp, file);

    cache = store;
    index = buildIndex(store);
};

const clearThumbnails = (dir: string, keep: Set<string>) => {
    if (!fs.existsSync(dir)) return;
    for (const file of fs.readdirSync(dir)) {
        if (!isImageFile(file) || keep.has(file)) continue;
        const full = path.join(dir, file);
        if (fs.existsSync(full)) fs.rmSync(full);
    }
};

/**
 * Referenzbilder, auf die kein Eintrag mehr zeigt. Ohne das hier waechst der
 * Ordner mit jedem geloeschten Bild weiter — die Vorlagen selbst stehen ja in
 * keiner Uebersicht und fielen niemandem auf.
 */
const clearReferences = (entries: DataImage[]) => {
    const dir = path.join(appConfig.baseFolder, REFERENCE_DIR);
    if (!fs.existsSync(dir)) return;
    const used = new Set(entries.flatMap(entry => entry.referenceImages ?? []));
    for (const file of fs.readdirSync(dir)) {
        if (used.has(file)) continue;
        const full = path.join(dir, file);
        if (fs.existsSync(full)) fs.rmSync(full);
    }
};

/**
 * Entfernt genau einen Eintrag samt seiner Vorschaubilder und der Vorlagen,
 * die sonst niemand mehr braucht.
 *
 * Beim Löschen eines Bildes lief bisher `cleanDataStore` — das räumt aber den
 * **ganzen** Ordner auf und löscht dabei jede Datei ohne Eintrag. Zwischen dem
 * Schreiben einer frisch erzeugten Bilddatei und ihrem Eintrag liegt ein
 * `await`; wer in dieser Spanne ein anderes Bild löschte, verlor das neue
 * gleich mit.
 */
export const removeEntry = (fileName: string): void => {
    const store = getDataStore();
    const entry = index.get(fileName);
    const kept = store.data.filter(item => item.fileName !== fileName);
    saveDataStore({ entries: kept.length, data: kept });

    for (const dir of [thumbnailDir, bigThumbnailDir]) {
        const full = path.join(dir, fileName);
        if (fs.existsSync(full)) fs.rmSync(full);
    }

    // Vorlagen nur, wenn kein anderer Eintrag sie noch nutzt.
    const stillUsed = new Set(kept.flatMap(item => item.referenceImages ?? []));
    for (const reference of entry?.referenceImages ?? []) {
        if (stillUsed.has(reference)) continue;
        const full = path.join(appConfig.baseFolder, REFERENCE_DIR, reference);
        if (fs.existsSync(full)) fs.rmSync(full);
    }
};

/**
 * Gleicht Bestand und Bilderordner ab: Einträge ohne Datei fliegen raus,
 * Dateien ohne Eintrag werden gelöscht.
 *
 * **Nur beim Start aufrufen.** Der zweite Teil ist scharf: zwischen dem
 * Schreiben einer frischen Bilddatei und ihrem Eintrag liegt ein kurzer
 * Moment, in dem sie hier als verwaist gilt.
 */
export const cleanDataStore = (): void => {
    const dataStore = getDataStore();
    if (!fs.existsSync(appConfig.baseFolder)) return;

    // `Set` statt `Array.includes` im `filter`: das waren zuvor zwei Schleifen
    // mit je einer halben Million Stringvergleichen.
    const files = new Set(fs.readdirSync(appConfig.baseFolder).filter(isImageFile));
    const kept = dataStore.data.filter(entry => entry.fileName && files.has(entry.fileName));
    const keptNames = new Set(kept.map(entry => entry.fileName as string));

    for (const file of files) {
        if (keptNames.has(file)) continue;
        const full = path.join(appConfig.baseFolder, file);
        if (fs.existsSync(full)) fs.rmSync(full);
    }

    const removedEntries = dataStore.data.length - kept.length;
    const removedFiles = files.size - keptNames.size;
    if (removedEntries > 0 || removedFiles > 0) {
        console.log(`Bestand aufgeraeumt: ${removedEntries} Eintraege ohne Datei, ${removedFiles} Dateien ohne Eintrag.`);
    }

    saveDataStore({ entries: kept.length, data: kept });
    clearThumbnails(thumbnailDir, keptNames);
    clearThumbnails(bigThumbnailDir, keptNames);
    clearReferences(kept);
};
