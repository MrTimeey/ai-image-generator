import { ClientOptions, OpenAI } from 'openai';
import appConfig from '../common/appConfig';
import { GeneratedImage, GeneratedImages, ImageQuality, ImageSize, LanguageModel } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { currentTimestamp } from '../common/timeUtils';
import { getFileName } from '../common/fileUtils';
import Image = OpenAI.Image;
import { ImageGenerateParams } from 'openai/src/resources/images';

const configuration: ClientOptions = {
    organization: appConfig.organization,
    apiKey: appConfig.apiKey,
};
const openai = new OpenAI(configuration);

export const generateImages = async (
    prompt: string,
    languageModel: LanguageModel = LanguageModel.DALL_E_TWO,
    size: ImageSize = ImageSize.SMALL,
    quality: ImageQuality = ImageQuality.STANDARD
): Promise<GeneratedImages> => {
    try {
        const body: ImageGenerateParams = {
            model: languageModel,
            prompt: prompt,
            n: 1,
            size: size,
            quality: quality,
        };
        if (languageModel === LanguageModel.DALL_E_THREE) {
            body.style = 'vivid';
        }
        const response = await openai.images.generate(body);
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
