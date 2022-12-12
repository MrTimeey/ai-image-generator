import axios from 'axios';
import fs from 'fs';
import { ImageUrl } from '../types';
import { getDataStore, saveDataStore } from './dataStore';
import appConfig from './appConfig';

export const createFolder = (name: string) => {
    if (!fs.existsSync(name)) {
        fs.mkdirSync(name);
    }
};

export const persistImage = (image: ImageUrl, createdAt: string, description: string): void => {
    const dataStore = getDataStore();
    dataStore.data.push({
        createdAt: createdAt,
        id: image.id,
        url: image.url,
        description: description,
    });
    dataStore.entries++;
    saveDataStore(dataStore);
};

export const downloadImage = (image: ImageUrl, createdAt: string): void => {
    createFolder(appConfig.baseFolder);
    axios({
        url: image.url,
        responseType: 'stream',
    }).then(
        (response) =>
            new Promise<void>((resolve, reject) => {
                response.data
                    .pipe(fs.createWriteStream(`${appConfig.baseFolder}/${createdAt}_${image.id}.png`))
                    .on('finish', () => resolve())
                    .on('error', (e: unknown) => reject(e));
            })
    );
};
