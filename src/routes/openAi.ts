import express from 'express';
import { generateImages } from '../controller/openAiController';
import { GeneratedImages, GenerateImagesRequest, ImageSize } from '../types';
import { downloadImage, persistImage } from '../common/fileUtils';
import appConfig from '../common/appConfig';

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

openAi.post('/generate-image', async (req, res) => {
    const { description, size, amount } = req.body as GenerateImagesRequest;
    if (!description || !validSizeProp(size) || !validAmountProp(amount)) {
        res.status(400).send({ success: false });
        return;
    }
    const typedImageSize = size ? ImageSize[size] : undefined;
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

export default openAi;
