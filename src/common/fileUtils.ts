import axios from 'axios';
import fs from 'fs';
import { ImageUrl, LanguageModel } from '../types';
import { getDataStore, saveDataStore } from './dataStore';
import appConfig from './appConfig';
import { randomUUID } from 'crypto';

const tempDir = './temp';

export const createFolder = (name: string) => {
    if (!fs.existsSync(name)) {
        fs.mkdirSync(name);
    }
};

export const getFileName = (id: string, createdAt: string) => {
    return `${createdAt}_${id}.png`;
};

export const persistImage = (image: ImageUrl, createdAt: string, languageModel: LanguageModel, description = ''): void => {
    const dataStore = getDataStore();
    dataStore.data.push({
        createdAt: createdAt,
        id: image.id,
        url: image.url,
        fileName: image.fileName,
        languageModel: languageModel,
        description: description,
    });
    dataStore.entries++;
    saveDataStore(dataStore);
};

export const downloadImage = (image: ImageUrl): void => {
    createFolder(appConfig.baseFolder);
    axios({
        url: image.url,
        responseType: 'stream',
    }).then(
        (response: any) =>
            new Promise<void>((resolve, reject) => {
                response.data
                    .pipe(fs.createWriteStream(`${appConfig.baseFolder}/${image.fileName}`))
                    .on('finish', () => resolve())
                    .on('error', (e: unknown) => reject(e));
            })
    );
};

export const createTempImage = (base64String: string): string => {
    createFolder('./temp');
    const regex = /data:image\/(.*?);base64,/;
    let fileEnding = 'png';
    if (regex.test(base64String)) {
        const matchedString = base64String.match(regex) ?? [];
        fileEnding = matchedString.length > 0 ? matchedString[1] : 'png';
        base64String = base64String.replace(regex, '');
    }
    const buffer = Buffer.from(base64String, 'base64');
    const targetPath = `${tempDir}/${randomUUID()}.${fileEnding}`;
    fs.writeFileSync(targetPath, buffer);
    return targetPath;
};

export const deleteTempFolder = () => {
    if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
};
