import fs from 'fs';
import { GeneratedImage, LanguageModel } from '../types';
import { getDataStore, saveDataStore } from './dataStore';
import appConfig from './appConfig';
import request from 'sync-request';

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
