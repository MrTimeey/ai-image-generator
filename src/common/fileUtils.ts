import axios from 'axios';
import fs from 'fs';
import { ImageUrl } from '../types';
import { getDataStore, saveDataStore } from './dataStore';
import appConfig from './appConfig';
import { randomUUID } from 'crypto';

const tempDir = './temp';

export const createFolder = (name: string) => {
    if (!fs.existsSync(name)) {
        fs.mkdirSync(name);
    }
};

export const persistImage = (image: ImageUrl, createdAt: string, description = ''): void => {
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
