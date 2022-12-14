import * as dotenv from 'dotenv';
import { ApplicationConfig } from '../types';

const config = dotenv.config();

if (config.error) {
    throw config.error;
}

if (!process.env.OPEN_AI_API_KEY || !process.env.OPEN_AI_ORG_ID) {
    throw new Error('Missing environments!');
}

const shouldImagesBeSaved = (): boolean => {
    const saveImagesEnabledEnv: string = process.env.AI_IMAGE_GENERATOR_SAVE_IMAGES || 'false';
    return 'true' === saveImagesEnabledEnv;
};

const appConfig: ApplicationConfig = {
    port: parseInt(process.env.AI_IMAGE_GENERATOR_PORT as string) || 3000,
    apiKey: process.env.OPEN_AI_API_KEY,
    organization: process.env.OPEN_AI_ORG_ID,
    saveImagesEnabled: shouldImagesBeSaved(),
    baseFolder: process.env.AI_IMAGE_GENERATOR_OUTPUT_PATH || './generated',
};

export default appConfig;
