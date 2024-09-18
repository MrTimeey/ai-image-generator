import express from 'express';
import { alternativeImages, generateImages } from '../controller/openAiController';
import {
    BaseImages,
    GenerateAlternativesRequest,
    GeneratedImages,
    GenerateImagesRequest,
    ImageQuality,
    ImageSize,
    LanguageModel,
} from '../types';
import { createTempImage, deleteTempFolder, downloadImage, persistImage } from '../common/fileUtils';
import appConfig from '../common/appConfig';
import fs from 'fs';

const openAi: express.Router = express.Router();

const validSizeProp = (languageModel: LanguageModel, size: string | undefined): boolean => {
    if (!size) return true;
    if (languageModel === LanguageModel.DALL_E_TWO) {
        return ['SMALL', 'MEDIUM', 'LARGE'].includes(size);
    }
    return ['LARGE', 'LARGE_HORIZONTAL', 'LARGE_VERTICAL'].includes(size);
};

const validAmountProp = (languageModel: LanguageModel, amount: number | undefined): boolean => {
    if (!amount) return true;
    if (!Number.isInteger(amount)) return false;
    return languageModel === LanguageModel.DALL_E_TWO ? amount >= 1 && amount <= 10 : amount === 1;
};

const getTypedImageSize = (size: string | undefined): ImageSize | undefined => {
    // @ts-ignore
    return size && Object.keys(ImageSize).includes(size) ? ImageSize[size] : undefined;
};

const getTypedLanguageModel = (languageModel: 'DALL_E_TWO' | 'DALL_E_THREE' | undefined) => {
    return languageModel && Object.keys(LanguageModel) ? LanguageModel[languageModel] : LanguageModel.DALL_E_TWO;
};

const getTypedQuality = (quality: 'STANDARD' | 'HD' | undefined) => {
    return quality && Object.keys(quality) ? ImageQuality[quality] : ImageQuality.STANDARD;
};

openAi.post('/generate-images', async (req, res) => {
    const { description, languageModel, quality, size, amount } = req.body as GenerateImagesRequest;
    const typedLanguageModel = getTypedLanguageModel(languageModel);
    const typedQuality = getTypedQuality(quality);
    if (!description || !validSizeProp(typedLanguageModel, size) || !validAmountProp(typedLanguageModel, amount)) {
        res.status(400).send({ success: false });
        return;
    }
    const typedImageSize = getTypedImageSize(size);

    const images: GeneratedImages = await generateImages(description, typedLanguageModel, amount, typedImageSize, typedQuality);
    if (images.urls.length === 0) {
        res.status(500).send({ success: false });
        return;
    }
    if (appConfig.saveImagesEnabled) {
        images.urls.forEach((image) => {
            persistImage(image, images.createdAt, typedLanguageModel, images.description);
            downloadImage(image);
        });
    }
    res.status(200).send({ createdAt: images.createdAt, images: images.urls });
});

openAi.post('/generate-alternative-images', async (req, res) => {
    const { baseImage, size, languageModel, amount, originalImageName = '' } = req.body as GenerateAlternativesRequest;
    const typedLanguageModel = getTypedLanguageModel(languageModel);
    if (typedLanguageModel === LanguageModel.DALL_E_THREE) {
        res.status(400).send({ success: false });
        return;
    }
    if (!baseImage || !validSizeProp(typedLanguageModel, size) || !validAmountProp(typedLanguageModel, amount)) {
        res.status(400).send({ success: false });
        return;
    }
    const input = fs.createReadStream(createTempImage(baseImage)) as any;
    const images: BaseImages = await alternativeImages(input, amount, typedLanguageModel, getTypedImageSize(size));
    deleteTempFolder();
    if (images.urls.length === 0) {
        res.status(500).send({ success: false });
        return;
    }
    if (appConfig.saveImagesEnabled) {
        images.urls.forEach((image) => {
            persistImage(image, images.createdAt, typedLanguageModel, `Alternative for: ${originalImageName}`);
            downloadImage(image);
        });
    }
    res.status(200).send({ createdAt: images.createdAt, images: images.urls });
});

export default openAi;
