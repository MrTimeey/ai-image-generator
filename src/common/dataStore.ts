import fs from 'fs';
import { ImageDataStore } from '../types';
import appConfig from './appConfig';
import path from 'node:path';

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

export const saveDataStore = (store: ImageDataStore) => {
    if (!fs.existsSync(`${appConfig.baseFolder}`)) {
        fs.mkdirSync(`${appConfig.baseFolder}`);
    }
    fs.writeFileSync(`${appConfig.baseFolder}/${dataStoreName}`, JSON.stringify(store, null, 2), 'utf-8');
};

export const cleanDataStore = () => {
    const dataStore = getDataStore();
    if (dataStore.entries === 0 || !fs.existsSync(`${appConfig.baseFolder}`)) {
        return;
    }
    const files = fs.readdirSync(appConfig.baseFolder).filter((file) => '.png' === path.extname(file));
    const filteredFiles = dataStore.data.filter((i) => i.fileName && files.includes(i.fileName));
    dataStore.data = filteredFiles;
    dataStore.entries = filteredFiles.length;
    saveDataStore(dataStore);
};
