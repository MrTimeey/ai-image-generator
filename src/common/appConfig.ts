import * as dotenv from 'dotenv';
import { ApplicationConfig } from '../types';

dotenv.config();

if (!process.env.OPEN_AI_API_KEY || !process.env.OPEN_AI_ORG_ID) {
    throw new Error('Missing environments!');
}

const shouldImagesBeSaved = (): boolean => {
    const saveImagesEnabledEnv: string = process.env.AI_IMAGE_GENERATOR_SAVE_IMAGES || 'false';
    return 'true' === saveImagesEnabledEnv;
};

const isAuthEnabled = (): boolean => {
    const authEnabledEnv: string = process.env.AUTH_ENABLED || 'false';
    return 'true' === authEnabledEnv;
};
if (isAuthEnabled() && !process.env.JWT_SECRET) {
    if (!process.env.JWT_SECRET || !process.env.AUTH_USER || !process.env.AUTH_PASS)
    throw new Error('Missing environments!');
}

const appConfig: ApplicationConfig = {
    port: parseInt(process.env.AI_IMAGE_GENERATOR_PORT as string) || 3000,
    apiKey: process.env.OPEN_AI_API_KEY,
    organization: process.env.OPEN_AI_ORG_ID,
    saveImagesEnabled: shouldImagesBeSaved(),
    baseFolder: process.env.AI_IMAGE_GENERATOR_OUTPUT_PATH || './generated',
    enableAuth: isAuthEnabled(),
    auth: {
        jwtSecret: process.env.JWT_SECRET ?? '',
        user: process.env.AUTH_USER ?? '',
        pass: process.env.AUTH_PASS ?? '',
    }
};

export default appConfig;
