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

export async function createThumbnail(image: string) {
    const thumbnailPath = path.join(thumbnailDir, image);
    if (!fs.existsSync(thumbnailPath)) {
        await sharp(path.join(imageDir, image)).resize(200).toFile(thumbnailPath);
    }
}

thumbnails.get('/all', async (req, res) => {
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
    images.sort(function(x, y) {
        if (!imageMap[x]?.createdAt || !imageMap[y]?.createdAt) return -1;
        return fromFormated(imageMap[x].createdAt).isBefore(fromFormated(imageMap[y].createdAt)) ? 0 : 1;
    })
    res.send(images)
})

export default thumbnails;
