import express from 'express';
import fs from 'fs-extra';
import appConfig from '../common/appConfig';
import sharp from 'sharp';
import path from 'path';

const thumbnails: express.Router = express.Router();

const thumbnailDir = `${__dirname}/../static/thumbnails`;
const imageDir = `${appConfig.baseFolder}`;

thumbnails.get('/overview', async (req, res) => {
    console.log('Test', thumbnailDir);
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
                    .resize(200) // Größe des Thumbnails
                    .toFile(thumbnailPath);
            }
        }

        const mapToImage = (image: string) => `
                  <div style="display: inline-block; margin: 10px;">
                    <a href="http://localhost:3000/api/files/open/${image}"><img src="/thumbnails/${image}" title="${image}" alt="${image}" /></a>
                  </div>
                `;

        res.send(`
          <html>
            <head>
              <title>Galerie</title>
            </head>
            <body>
              <h1>Thumbnail Galerie</h1>
              <div>
                ${images.map((image) => mapToImage(image)).join('')}
              </div>
            </body>
          </html>
        `);
    });
});
export default thumbnails;
