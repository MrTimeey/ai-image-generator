import express from 'express';
import { generateImages, alternativeImages } from '../controller/openAiController';
import { BaseImages, GenerateAlternativesRequest, GeneratedImages, GenerateImagesRequest, ImageSize } from '../types';
import { createTempImage, deleteTempFolder, downloadImage, persistImage } from "../common/fileUtils";
import appConfig from '../common/appConfig';
import fs from "fs";

const openAi: express.Router = express.Router();

const validSizeProp = (size: string | undefined): boolean => {
    if (!size) return true;
    return Object.keys(ImageSize).includes(size);
};

const validAmountProp = (amount: number | undefined): boolean => {
    if (!amount) return true;
    if (!Number.isInteger(amount)) return false;
    return amount >= 1 && amount <= 10;
};

const getTypedImageSize = (size: 'SMALL' | 'MEDIUM' | 'LARGE' | undefined) => {
    return size ? ImageSize[size] : undefined;
};

openAi.post('/generate-images', async (req, res) => {
    const { description, size, amount } = req.body as GenerateImagesRequest;
    if (!description || !validSizeProp(size) || !validAmountProp(amount)) {
        res.status(400).send({ success: false });
        return;
    }
    const typedImageSize = getTypedImageSize(size);
    const images: GeneratedImages = await generateImages(description, amount, typedImageSize);
    if (images.urls.length === 0) {
        res.status(500).send({ success: false });
        return;
    }
    if (appConfig.saveImagesEnabled) {
        images.urls.forEach((image) => {
            persistImage(image, images.createdAt, images.description);
            downloadImage(image, images.createdAt);
        });
    }
    res.status(200).send({ createdAt: images.createdAt, urls: images.urls });
});

openAi.post('/generate-alternative-images', async (req, res) => {
    const { baseImage, size, amount, originalImageName = '' } = req.body as GenerateAlternativesRequest;
    if (!baseImage || !validSizeProp(size) || !validAmountProp(amount)) {
        res.status(400).send({ success: false });
        return;
    }
    const input = fs.createReadStream(createTempImage(baseImage)) as any;
    const images: BaseImages = await alternativeImages(input, amount, getTypedImageSize(size));
    deleteTempFolder();
    if (images.urls.length === 0) {
        res.status(500).send({ success: false });
        return;
    }
    if (appConfig.saveImagesEnabled) {
        images.urls.forEach((image) => {
            persistImage(image, images.createdAt, originalImageName);
            downloadImage(image, images.createdAt);
        });
    }
    res.status(200).send({ createdAt: images.createdAt, urls: images.urls });
});

export default openAi;
