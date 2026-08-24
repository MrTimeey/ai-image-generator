import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { DataImage, GeneratedImage, OutputFormat, ProviderImage } from '../types';
import { getDataStore, saveDataStore } from './dataStore';
import appConfig from './appConfig';
import { ModelDefinition } from '../controller/modelRegistry';

/** Alles, was die App als Bild akzeptiert — Thumbnails und Aufraeumen inklusive. */
export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];

export const isImageFile = (fileName: string): boolean =>
    IMAGE_EXTENSIONS.includes(path.extname(fileName).toLowerCase());

const extensionFor = (format: OutputFormat): string => (format === 'jpeg' ? '.jpg' : `.${format}`);

export const getFileName = (id: string, createdAt: string, format: OutputFormat = 'png'): string =>
    `${createdAt}_${id}${extensionFor(format)}`;

/**
 * Schuetzt die Dateioperationen davor, dass ein Name aus der URL den
 * Bilderordner verlaesst. `path.basename` allein genuegt nicht — ein Name aus
 * lauter Punkten kaeme durch.
 */
export const safeImageName = (name: string): string | null => {
    const base = path.basename(name);
    if (base !== name) return null;
    if (!/^[A-Za-z0-9._-]+$/.test(base)) return null;
    if (base.startsWith('.')) return null;
    if (!isImageFile(base)) return null;
    return base;
};

export const imagePath = (fileName: string): string => path.join(appConfig.baseFolder, fileName);

const ensureBaseFolder = (): void => {
    if (!fs.existsSync(appConfig.baseFolder)) {
        fs.mkdirSync(appConfig.baseFolder, { recursive: true });
    }
};

/**
 * Holt die Bytes eines erzeugten Bildes. OpenAI liefert sie direkt (base64),
 * BFL nur eine URL, die nach rund zehn Minuten verfaellt — deshalb wird hier
 * sofort geladen und nicht spaeter.
 */
export const fetchImageBytes = async (image: ProviderImage): Promise<Buffer> => {
    if (image.buffer) return image.buffer;
    if (!image.url) throw new Error('Provider lieferte weder Bilddaten noch URL.');
    const response = await axios.get<ArrayBuffer>(image.url, {
        responseType: 'arraybuffer',
        timeout: 60_000,
    });
    return Buffer.from(response.data);
};

export const writeImage = (fileName: string, bytes: Buffer): void => {
    ensureBaseFolder();
    fs.writeFileSync(imagePath(fileName), bytes);
};

export const persistImage = (
    image: GeneratedImage,
    createdAt: string,
    model: ModelDefinition,
    description: string,
    ratio: string
): void => {
    const dataStore = getDataStore();
    const entry: DataImage = {
        id: image.id,
        fileName: image.fileName,
        createdAt,
        description,
        revisedPrompt: image.revisedPrompt ?? '',
        model: model.id,
        provider: model.provider,
        ratio,
        width: image.width,
        height: image.height,
    };
    dataStore.data.push(entry);
    dataStore.entries = dataStore.data.length;
    saveDataStore(dataStore);
};

/** `model` fuer neue Eintraege, `languageModel` fuer alles von vor dem Umbau. */
export const modelNameOf = (entry: DataImage | undefined): string =>
    entry?.model ?? entry?.languageModel ?? '';
