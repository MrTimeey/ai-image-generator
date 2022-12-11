import * as dotenv from 'dotenv';
import { ApplicationConfig } from '../types';

const config = dotenv.config();

if (config.error) {
    throw config.error;
}

if (!process.env.OPEN_AI_API_KEY || !process.env.OPEN_AI_ORG_ID) {
    throw new Error('Missing environments!');
}

const appConfig: ApplicationConfig = {
    port: parseInt(process.env.PORT as string) || 3000,
    apiKey: process.env.OPEN_AI_API_KEY,
    organization: process.env.OPEN_AI_ORG_ID,
};

export default appConfig;
