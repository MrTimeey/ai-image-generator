import express from 'express';
import { generateImages } from '../controller/bflController';
import { GeneratedImages } from '../types';
import { downloadFile, persistImage } from '../common/fileUtils';
import { createBigThumbnail } from './files';
import { createThumbnail } from './thumbnails';
import { z } from 'zod';
import { BflLanguageModel, BflOutputFormat, BflRatio } from '../controller/bflTypes';

const bfl: express.Router = express.Router();

const BflImagesRequestSchema = z.object({
    description: z.string().min(1),
    amount: z.number().int().min(1).max(4).optional().default(1),
    languageModel: z.nativeEnum(BflLanguageModel).optional().default(BflLanguageModel.FLUX_PRO),
    ratio: z.enum(Object.values(BflRatio) as [BflRatio, ...BflRatio[]]).optional().default(BflRatio['1x1']),
    outputFormat: z.nativeEnum(BflOutputFormat).optional().default(BflOutputFormat.PNG),
});

bfl.post('/generate-images', async (req, res) => {
    const parseResult = BflImagesRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
        return res.status(400).send({ success: false, errors: parseResult.error.errors });
    }
    const { description, languageModel, amount, ratio, outputFormat } = parseResult.data;

    const images: GeneratedImages = await generateImages(description, languageModel, ratio, outputFormat, amount);
    if (images.images.length === 0) {
        res.status(500).send({ success: false });
        return;
    }
    for (const image of images.images) {
        persistImage(image, images.createdAt, images.languageModel, images.description);
        downloadFile(image);
        await createBigThumbnail(image.fileName);
        await createThumbnail(image.fileName)
    }
    res.status(200).send({ createdAt: images.createdAt, images: images.images });
});

export default bfl;
