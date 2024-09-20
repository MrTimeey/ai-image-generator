import { ClientOptions, OpenAI } from 'openai';
import appConfig from '../common/appConfig';
import { BaseImages, GeneratedImages, ImageQuality, ImageSize, GeneratedImage, LanguageModel } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { currentTimestamp } from '../common/timeUtils';
import { getFileName } from '../common/fileUtils';
import Image = OpenAI.Image;

const configuration: ClientOptions = {
    organization: appConfig.organization,
    apiKey: appConfig.apiKey,
};
const openai = new OpenAI(configuration);

const mapImageSize = (size: string | undefined): ImageSize.SMALL | ImageSize.MEDIUM | ImageSize.LARGE => {
    switch (size) {
        case ImageSize.SMALL:
            return ImageSize.SMALL;
        case ImageSize.MEDIUM:
            return ImageSize.MEDIUM;
        case ImageSize.LARGE:
            return ImageSize.LARGE;
        case ImageSize.LARGE_HORIZONTAL:
        case ImageSize.LARGE_VERTICAL:
            return ImageSize.LARGE;
        default:
            return ImageSize.SMALL;
    }
};

export const alternativeImages = async (image: File, numberOfImages = 1, languageModel: LanguageModel = LanguageModel.DALL_E_TWO, size: ImageSize = ImageSize.SMALL): Promise<BaseImages> => {
    try {
        const response = await openai.images.createVariation({
            model: languageModel,
            image,
            n: numberOfImages,
            size: mapImageSize(size),
        });
        const created = currentTimestamp();
        const images =
            response.data
                .map((i: Image) => ({ ...i, url: i.url ?? 'not_found' }))
                .filter((i: Image) => i.url !== 'not_found')
                .map((i: Image) => {
                    const id = uuidv4();
                    return { id: id, url: i.url ?? 'not_found', fileName: getFileName(id, created), revisedPrompt: i.revised_prompt ?? '' };
                }) ?? [];
        return {
            languageModel,
            createdAt: created,
            images: images,
        };
    } catch (error: any) {
        if (error.response) {
            console.log(error.response.status, error.response.data);
        } else {
            console.log(error.message);
        }
    }
    return { createdAt: currentTimestamp(), languageModel, images: [] };
};

export const generateImages = async (
    prompt: string,
    languageModel: LanguageModel = LanguageModel.DALL_E_TWO,
    numberOfImages = 1,
    size: ImageSize = ImageSize.SMALL,
    quality: ImageQuality = ImageQuality.STANDARD
): Promise<GeneratedImages> => {
    try {
        const response = await openai.images.generate({
            model: languageModel,
            prompt: prompt,
            n: numberOfImages,
            size: size,
            quality: quality,
        });
        const created = currentTimestamp();
        const images: GeneratedImage[] =
            response.data
                .map((i: Image) => ({ ...i, url: i.url ?? 'not_found' }))
                .filter((i: Image) => i.url !== 'not_found')
                .map((i: Image) => {
                    const id = uuidv4();
                    return { id: id, url: i.url ?? 'not_found', fileName: getFileName(id, created), revisedPrompt: i.revised_prompt ?? 'not_found' };
                }) ?? [];
        return {
            createdAt: created,
            languageModel,
            description: prompt,
            images: images,
        };
    } catch (error: any) {
        if (error.response) {
            console.log(error.response.status, error.response.data);
        } else {
            console.log(error.message);
        }
    }
    return { createdAt: currentTimestamp(), languageModel, description: prompt, images: [] };
};
