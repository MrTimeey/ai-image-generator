import express, { Request } from 'express';
import fs from 'fs-extra';
import appConfig from '../common/appConfig';
import sharp from 'sharp';
import path from 'path';
import { getDataStore } from '../common/dataStore';
import { DataImage, Sorting } from '../types';
import { fromFormated } from '../common/timeUtils';

const thumbnails: express.Router = express.Router();

export const thumbnailDir = `${__dirname}/../static/thumbnails`;
const imageDir = `${appConfig.baseFolder}`;

export async function createThumbnail(image: string) {
    const thumbnailPath = path.join(thumbnailDir, image);
    const imagePath = path.join(appConfig.baseFolder, image);
    if (!fs.existsSync(thumbnailPath) && fs.existsSync(imagePath)) {
        await sharp(imagePath.replace('.png', '.PNG')).resize(200).toFile(thumbnailPath);
    }
}

const getSorting = (req: Request): Sorting => {
    const queryParam = req.query?.sorting;
    switch (queryParam) {
        case Sorting.DESCENDING:
            return Sorting.DESCENDING;
        case Sorting.ASCENDING:
        default:
            return Sorting.ASCENDING
    }
}

thumbnails.get('/all', async (req, res) => {
    const sorting = getSorting(req)

    fs.ensureDirSync(thumbnailDir);
    const fileNames = fs.readdirSync(imageDir);
    const images = fileNames.filter((file) => /\.(jpg|jpeg|png)$/.test(file));

    for (const image of images) {
        await createThumbnail(image);
    }
    const dataStore = getDataStore();
    const imageMap: { [key: string]: DataImage } = dataStore.data.reduce((acc, i) => {
        if (!i.fileName) return acc;
        return { ...acc, [i.fileName]: i };
    }, {})
    const sortedImages = images.sort(function(x, y) {
        if (!imageMap[x]?.createdAt || !imageMap[y]?.createdAt) return -1;
        const dateX = fromFormated(imageMap[x].createdAt);
        const dateY = fromFormated(imageMap[y].createdAt);

        if (sorting === Sorting.ASCENDING) {
            if (dateX.isBefore(dateY)) return -1;
            if (dateX.isAfter(dateY)) return 1;
        } else {
            if (dateX.isBefore(dateY)) return 1;
            if (dateX.isAfter(dateY)) return -1;
        }
        return 0;
    })
    res.send(sortedImages)
})

export default thumbnails;
