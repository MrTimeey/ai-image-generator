import express from 'express';
import fs from 'fs-extra';
import appConfig from '../common/appConfig';
import { getDataStore } from '../common/dataStore';
import sharp from 'sharp';
import path from 'path';
import { fromFormated, READ_FORMAT } from '../common/timeUtils';

const files: express.Router = express.Router();

const imageDir = `${appConfig.baseFolder}`;
export const bigThumbnailDir = `${__dirname}/../static/big-thumbnails`;

files.get('/download/:imageName', async (req, res) => {
    const imageName = req.params.imageName;
    if (!fs.existsSync(`${imageDir}/${imageName}`)) {
        return res.status(500).send('Fehler beim Laden des Bildes.');
    }
    res.download(`${imageDir}/${imageName}`);
});

files.get('/open/:imageName', async (req, res) => {
    const imageName = req.params.imageName;
    const imagePath = `${imageDir}/${imageName}`;
    if (!fs.existsSync(imagePath)) {
        return res.status(500).send('Fehler beim Laden des Bildes.');
    }
    fs.ensureDirSync(bigThumbnailDir);
    const thumbnailPath = path.join(bigThumbnailDir, imageName);
    if (!fs.existsSync(thumbnailPath)) {
        await sharp(imagePath)
            .resize(512) // Größe des Thumbnails
            .toFile(thumbnailPath);
    }
    const dataStore = getDataStore();
    const dataStoreEntry = dataStore.data.find((i) => i.fileName === imageName);
    const formattedDate = fromFormated(dataStoreEntry?.createdAt??'')?.format(READ_FORMAT) ?? '';
    res.send(`
          <html>
            <head>
              <title>Detail View</title>
            </head>
            <body>
              <h1>Detail View</h1>
              <div style="display: flex; flex-direction: column; width: 80%">
                <a href="http://localhost:3000/api/files/download/${imageName}"><img style="width: 512px" src="/big-thumbnails/${imageName}" title="${imageName}" alt="${imageName}" /></a>
                <strong>Prompt: </strong><span>${dataStoreEntry?.description}</span>
                <strong>Revised Prompt: </strong><span>${dataStoreEntry?.revisedPrompt}</span>
                <strong>Created: </strong><span>${formattedDate}</span>
              </div>
            </body>
          </html>
        `);
});
export default files;
