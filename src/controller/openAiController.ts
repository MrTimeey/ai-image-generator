import { ClientOptions, OpenAI } from 'openai';
import appConfig from '../common/appConfig';
import { BaseImages, GeneratedImages, ImageSize, LanguageModel } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { currentTimestamp } from '../common/timeUtils';
import { getFileName } from '../common/fileUtils';

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
                .map((e: any) => e.url ?? 'not_found')
                .filter((e: any) => e !== 'not_found')
                .map((u: any) => {
                    const id = uuidv4();
                    return { id: id, url: u, fileName: getFileName(id, created) };
                }) ?? [];
        return {
            createdAt: created,
            urls: images,
        };
    } catch (error: any) {
        if (error.response) {
            console.log(error.response.status, error.response.data);
        } else {
            console.log(error.message);
        }
    }
    return { createdAt: currentTimestamp(), urls: [] };
};

export const generateImages = async (prompt: string, languageModel: LanguageModel = LanguageModel.DALL_E_TWO, numberOfImages = 1, size: ImageSize = ImageSize.SMALL): Promise<GeneratedImages> => {
    try {
        const response = await openai.images.generate({
            model: languageModel,
            prompt: prompt,
            n: numberOfImages,
            size: size,
        });
        const created = currentTimestamp();
        const images =
            response.data
                .map((e: any) => e.url ?? 'not_found')
                .filter((e: any) => e !== 'not_found')
                .map((u: string) => {
                    const id = uuidv4();
                    return { id: id, url: u, fileName: getFileName(id, created) };
                }) ?? [];
        return {
            createdAt: created,
            description: prompt,
            urls: images,
        };
    } catch (error: any) {
        if (error.response) {
            console.log(error.response.status, error.response.data);
        } else {
            console.log(error.message);
        }
    }
    return { createdAt: currentTimestamp(), description: prompt, urls: [] };
};
