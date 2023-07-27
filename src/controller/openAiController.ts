import { Configuration, OpenAIApi } from 'openai';
import appConfig from '../common/appConfig';
import { BaseImages, GeneratedImages, ImageSize } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { currentTimestamp, formatTimestamp } from '../common/timeUtils';

const configuration = new Configuration({
    organization: appConfig.organization,
    apiKey: appConfig.apiKey,
});
const openai = new OpenAIApi(configuration);

export const alternativeImages = async (image: File, numberOfImages = 1, size: ImageSize = ImageSize.SMALL): Promise<BaseImages> => {
    try {
        const response = await openai.createImageVariation(image, numberOfImages, size);
        const created = formatTimestamp(response.data.created);
        const images =
            response.data.data
                .map((e) => e.url ?? 'not_found')
                .filter((e) => e !== 'not_found')
                .map((u) => ({ id: uuidv4(), url: u })) ?? [];
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

export const generateImages = async (prompt: string, numberOfImages = 1, size: ImageSize = ImageSize.SMALL): Promise<GeneratedImages> => {
    try {
        const response = await openai.createImage({
            prompt: prompt,
            n: numberOfImages,
            size: size,
        });
        const created = formatTimestamp(response.data.created);
        const images =
            response.data.data
                .map((e) => e.url ?? 'not_found')
                .filter((e) => e !== 'not_found')
                .map((u) => ({ id: uuidv4(), url: u })) ?? [];
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
