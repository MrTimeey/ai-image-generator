import express from 'express';
import { generateImages } from '../controller/openAiController';
import { GeneratedImages, GenerateImagesRequest, ImageSize } from '../types';

const openAi: express.Router = express.Router();

function validSizeProp(size: string | undefined) {
    if (!size) return true;
    return Object.keys(ImageSize).includes(size);
}

openAi.post('/generate-image', async (req, res) => {
    const { description, size, amount } = req.body as GenerateImagesRequest;
    if (!description || !validSizeProp(size)) {
        res.status(400).send({ success: false });
        return;
    }
    const typedImageSize: ImageSize = size ? ImageSize[size] : ImageSize.SMALL;
    const images: GeneratedImages = await generateImages(description, amount, typedImageSize);
    if (images.urls.length === 0) {
        res.status(500).send({ success: false });
        return;
    }
    res.status(200).send({ createdAt: images.createdAt, urls: images.urls });
});

export default openAi;
