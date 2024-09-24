import express from 'express';
import fs from 'fs-extra';
import appConfig from '../common/appConfig';
import { getDataStore } from '../common/dataStore';
import sharp from 'sharp';
import path from 'path';
import { fromFormated, READ_FORMAT } from '../common/timeUtils';

const files: express.Router = express.Router();

const imageDir = `${appConfig.baseFolder}`;
export const bigThumbnailDir = `${__dirname}/../static/protected/big-thumbnails`;

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
    const header = fs.readFileSync(`${__dirname}/../static/protected/header.html`, 'utf-8');
    res.send(`
          <html>
            <head>
              <title>Detail View</title>
              <link rel="stylesheet" href="/css/style.css" />
            </head>
            <body>
              ${header}
              <div style="display: flex; flex-direction: column; width: 100%; align-items: center">
                <a href="/files/download/${imageName}"><img style="width: 512px" src="/protected/big-thumbnails/${imageName}" title="${imageName}" alt="${imageName}" /></a>
                <strong>Prompt: </strong><span class="spanEntry">${dataStoreEntry?.description}</span>
                <strong>Revised Prompt: </strong><span class="spanEntry">${dataStoreEntry?.revisedPrompt}</span>
                <strong>File Name: </strong><span class="spanEntry">${dataStoreEntry?.fileName}</span>
                <strong>Created: </strong><span class="spanEntry">${formattedDate}</span>
              </div>
            </body>
          </html>
        `);
});
export default files;
