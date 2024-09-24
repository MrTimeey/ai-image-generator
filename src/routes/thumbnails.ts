import express from 'express';
import fs from 'fs-extra';
import appConfig from '../common/appConfig';
import sharp from 'sharp';
import path from 'path';
import { getDataStore } from "../common/dataStore";
import { DataImage } from "../types";
import { fromFormated } from "../common/timeUtils";

const thumbnails: express.Router = express.Router();

export const thumbnailDir = `${__dirname}/../static/thumbnails`;
const imageDir = `${appConfig.baseFolder}`;

thumbnails.get('/overview', async (req, res) => {
    fs.ensureDirSync(thumbnailDir);
    fs.readdir(imageDir, async (err, files) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Fehler beim Laden der Bilder.');
        }

        const images = files.filter((file) => /\.(jpg|jpeg|png)$/.test(file));

        for (const image of images) {
            const thumbnailPath = path.join(thumbnailDir, image);
            if (!fs.existsSync(thumbnailPath)) {
                await sharp(path.join(imageDir, image))
                    .resize(200)
                    .toFile(thumbnailPath);
            }
        }
        const dataStore = getDataStore();
        const imageMap: {[key: string]: DataImage} = dataStore.data.reduce((acc, i) => {
            if (!i.fileName) return acc;
            return {...acc, [i.fileName]: i};
        }, {})
        images.sort(function(x, y) {
            if (!imageMap[x]?.createdAt || !imageMap[y]?.createdAt) return -1;
            return fromFormated(imageMap[x].createdAt).isBefore(fromFormated(imageMap[y].createdAt)) ? 0 : 1;
        })

        const mapToImage = (image: string) => `
                  <div style="display: inline-block; margin: 10px; width: 200px;">
                    <a href="http://localhost:3000/api/files/open/${image}"><img src="/thumbnails/${image}" title="${image}" alt="${image}" style="max-height:200px; max-width: 200px" /></a>
                  </div>
                `;

        const header = fs.readFileSync(`${__dirname}/../static/header.html`, 'utf-8');
        res.send(`
          <html>
            <head>
              <title>Galerie</title>
              <link rel="stylesheet" href="http://localhost:3000/css/style.css" />
            </head>
            <body>
              ${header}
              <div>
                ${images.map((image) => mapToImage(image)).join('')}
              </div>
            </body>
          </html>
        `);
    });
});
export default thumbnails;
