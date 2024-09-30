import express from 'express';
import fs from 'fs-extra';
import appConfig from '../common/appConfig';
import { cleanDataStore, getDataStore } from '../common/dataStore';
import sharp from 'sharp';
import path from 'path';
import { fromFormated, READ_FORMAT } from '../common/timeUtils';
import { DataImage, LanguageModel } from '../types';

const files: express.Router = express.Router();

const imageDir = `${appConfig.baseFolder}`;
export const bigThumbnailDir = path.join(__dirname, '..', 'static', 'big-thumbnails');

export const createBigThumbnail = async (imageName: string) => {
    fs.ensureDirSync(bigThumbnailDir);
    const thumbnailPath = path.join(bigThumbnailDir, imageName);
    if (!fs.existsSync(thumbnailPath)) {
        await sharp(path.join(imageDir, imageName))
            .resize(512) // Größe des Thumbnails
            .toFile(thumbnailPath);
    }
}

files.get('/download/:imageName', async (req, res) => {
    const imageName = req.params.imageName;
    if (!fs.existsSync(`${imageDir}/${imageName}`)) {
        return res.status(500).send('Fehler beim Laden des Bildes.');
    }
    res.download(`${imageDir}/${imageName}`);
});

const getLanguageModel = (dataStoreEntry: DataImage | undefined) => {
    const languageModel = dataStoreEntry?.languageModel ?? LanguageModel.DALL_E_TWO;
    return languageModel === LanguageModel.DALL_E_TWO ? 'DALL_E_TWO' : 'DALL_E_THREE'
}

files.get('/get/:imageName', async (req, res) => {
    const imageName = req.params.imageName;
    const imagePath = `${imageDir}/${imageName}`;
    if (!fs.existsSync(imagePath)) {
        return res.status(500).send('Fehler beim Laden des Bildes.');
    }
    await createBigThumbnail(imageName)
    const dataStore = getDataStore();
    const dataStoreEntry = dataStore.data.find((i) => i.fileName === imageName);
    const formattedDate = fromFormated(dataStoreEntry?.createdAt??'')?.format(READ_FORMAT) ?? '';
    res.send({
        prompt: dataStoreEntry?.description,
        revisedPrompt: dataStoreEntry?.revisedPrompt ?? 'unknown',
        filename: dataStoreEntry?.fileName,
        createdAt: formattedDate,
        languageModel: getLanguageModel(dataStoreEntry)
    })
})

files.delete('/:imageName', async (req, res) => {
    const imageName = req.params.imageName;
    const imagePath = `${imageDir}/${imageName}`;
    if (!fs.existsSync(imagePath)) {
        return res.sendStatus(200);
    }
    fs.rmSync(imagePath)
    cleanDataStore()
    res.sendStatus(200)
})

export default files;
