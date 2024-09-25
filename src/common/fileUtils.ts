import fs from 'fs';
import { GeneratedImage, LanguageModel } from '../types';
import { getDataStore, saveDataStore } from './dataStore';
import appConfig from './appConfig';
import { randomUUID } from 'crypto';
import request from 'sync-request';

const tempDir = './temp';

export const createFolder = (name: string) => {
    if (!fs.existsSync(name)) {
        fs.mkdirSync(name);
    }
};

export const getFileName = (id: string, createdAt: string): string => {
    return `${createdAt}_${id}.png`;
};

export const persistImage = (image: GeneratedImage, createdAt: string, languageModel: LanguageModel, description = ''): void => {
    const dataStore = getDataStore();
    dataStore.data.push({
        createdAt: createdAt,
        id: image.id,
        url: image.url,
        fileName: image.fileName,
        languageModel: languageModel,
        description: description,
        revisedPrompt: image.revisedPrompt,
    });
    dataStore.entries++;
    saveDataStore(dataStore);
};

export function downloadFile(image: GeneratedImage): void {
    try {
        const res = request('GET', image.url);
        if (res.statusCode === 200) {
            fs.writeFileSync(`${appConfig.baseFolder}/${image.fileName}`, res.getBody());
            console.log('Download completed!');
        } else {
            console.error(`Failed to get '${image.url}' (${res.statusCode})`);
        }
    } catch (error: any) {
        console.error(`Error downloading file: ${error.message}`);
    }
}

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
