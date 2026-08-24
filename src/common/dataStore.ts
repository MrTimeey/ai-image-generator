import fs from 'fs';
import { DataImage, ImageDataStore } from '../types';
import appConfig from './appConfig';
import path from 'node:path';
import { bigThumbnailDir } from '../routes/files';
import { thumbnailDir } from '../routes/thumbnails';
import { isImageFile, REFERENCE_DIR } from './fileUtils';

const dataStoreName = `data.json`;

export const getDataStore = (): ImageDataStore => {
    if (!fs.existsSync(`${appConfig.baseFolder}/${dataStoreName}`)) {
        return {
            entries: 0,
            data: [],
        };
    }
    const objString = fs.readFileSync(`${appConfig.baseFolder}/${dataStoreName}`, { encoding: 'utf8', flag: 'r' });
    return JSON.parse(objString);
};

export const getDataStoreFromPath = (path: string): ImageDataStore => {
    if (!fs.existsSync(path)) {
        return {
            entries: 0,
            data: [],
        };
    }
    const objString = fs.readFileSync(`${path}/${dataStoreName}`, { encoding: 'utf8', flag: 'r' });
    return JSON.parse(objString);
};

export const getImageMap = (dataStore: ImageDataStore): { [key: string]: DataImage } => {
    return dataStore.data.reduce((acc, i) => {
        if (!i.fileName) return acc;
        return { ...acc, [i.fileName]: i };
    }, {})
}

export const saveDataStore = (store: ImageDataStore) => {
    if (!fs.existsSync(`${appConfig.baseFolder}`)) {
        fs.mkdirSync(`${appConfig.baseFolder}`);
    }
    fs.writeFileSync(`${appConfig.baseFolder}/${dataStoreName}`, JSON.stringify(store, null, 2), 'utf-8');
};

type ImageMap = {[key: string]: DataImage}

const clearThumbnails = (dir: string, imageMap: ImageMap) => {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir)
        .filter((file: string) => isImageFile(file))
        .filter(f => !imageMap[f])
        .map(f => path.join(dir, f))
        .filter(p => fs.existsSync(p))
        .forEach(p => fs.rmSync(p));
}

export const cleanDataStore = () => {
    const dataStore = getDataStore();
    if (dataStore.entries === 0 || !fs.existsSync(`${appConfig.baseFolder}`)) {
        return;
    }
    // Frueher stand hier ein harter `.png`-Vergleich. Seit BFL auch jpeg
    // liefert, haette der jeden solchen Eintrag aus `data.json` geworfen —
    // das Bild blieb liegen, Prompt und Modell waren weg.
    const files = fs.readdirSync(appConfig.baseFolder).filter(isImageFile);
    const filteredFiles = dataStore.data.filter((i) => i.fileName && files.includes(i.fileName));
    dataStore.data = filteredFiles;
    dataStore.entries = filteredFiles.length;

    const filteredFileNames = dataStore.data.map(i => i.fileName);
    files.filter(f => !filteredFileNames.includes(f)).forEach(i => fs.rmSync(path.join(appConfig.baseFolder, i)))

    saveDataStore(dataStore);

    const imageMap: ImageMap = filteredFiles.reduce((acc, i) => {
        if (!i.fileName) return acc;
        return {...acc, [i.fileName]: i};
    }, {})
    clearThumbnails(thumbnailDir, imageMap);
    clearThumbnails(bigThumbnailDir, imageMap);
    clearReferences(filteredFiles);
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
    fs.readdirSync(dir)
        .filter(file => !used.has(file))
        .map(file => path.join(dir, file))
        .filter(p => fs.existsSync(p))
        .forEach(p => fs.rmSync(p));
};
