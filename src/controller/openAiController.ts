import { Configuration, OpenAIApi } from 'openai';
import appConfig from '../common/appConfig';
import { GeneratedImages, ImageSize } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { currentTimestamp, formatTimestamp } from '../common/timeUtils';
import fs from 'fs';

const configuration = new Configuration({
    organization: appConfig.organization,
    apiKey: appConfig.apiKey,
});
const openai = new OpenAIApi(configuration);

export const generateImages = async (prompt: string, numberOfImages = 1, size: ImageSize = ImageSize.SMALL): Promise<GeneratedImages> => {
    // @ts-ignore
    const response = await openai.createImageVariation(
        fs.createReadStream('C:/Users/t.kruse/OneDrive - Reply/Bilder/ai-image-generator/21-07-2023_11-05-46_ab4d9b72-b797-4142-84d8-89862faf79dc.png') as any,
        1,
        '1024x1024'
    );
    console.log('TIM', response.data.data[0].url);

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
