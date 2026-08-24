import * as dotenv from 'dotenv';
import { ApplicationConfig } from '../types';

dotenv.config();

const required = (name: string, value: string | undefined): string => {
    if (!value) throw new Error(`Missing environment variable: ${name}`);
    return value;
};

const isAuthEnabled = 'true' === (process.env.AUTH_ENABLED || 'false');

/**
 * Anbieter-Schluessel sind **einzeln** optional: wer nur BFL nutzt, soll die
 * App nicht mit einem OpenAI-Schluessel fuettern muessen. Nur ganz ohne
 * Schluessel ergibt sie keinen Sinn.
 */
const openAiKey = process.env.OPEN_AI_API_KEY ?? '';
const bflKey = process.env.BFL_API_KEY ?? '';
if (!openAiKey && !bflKey) {
    throw new Error('Neither OPEN_AI_API_KEY nor BFL_API_KEY is set — no provider available.');
}

const publicBaseUrl = (process.env.PUBLIC_BASE_URL ?? `http://localhost:${process.env.AI_IMAGE_GENERATOR_PORT ?? 3000}`).replace(/\/+$/, '');

const appConfig: ApplicationConfig = {
    port: parseInt(process.env.AI_IMAGE_GENERATOR_PORT as string) || 3000,
    publicBaseUrl,
    openai: {
        apiKey: openAiKey,
        // Optional: ein veraltetes Org-Id fuehrt zu 401 `mismatched_organization`
        // auf *jedem* Aufruf, ein fehlendes zu gar nichts.
        organization: process.env.OPEN_AI_ORG_ID ?? '',
        // Optional und bewusst getrennt vom Arbeitsschluessel: er darf nur
        // Nutzungsdaten lesen, nicht Bilder erzeugen.
        adminKey: process.env.OPEN_AI_ADMIN_KEY ?? '',
    },
    bfl: {
        apiKey: bflKey,
    },
    baseFolder: process.env.AI_IMAGE_GENERATOR_OUTPUT_PATH || './../ai-images',
    enableAuth: isAuthEnabled,
    isProduction: process.env.NODE_ENV === 'production' || publicBaseUrl.startsWith('https://'),
    auth: {
        // Alle vier sind nur mit eingeschalteter Anmeldung Pflicht — dann aber
        // wirklich, statt still auf '' zurueckzufallen wie frueher.
        sessionSecret: isAuthEnabled ? required('SESSION_SECRET', process.env.SESSION_SECRET) : '',
        issuer: isAuthEnabled ? required('OIDC_ISSUER', process.env.OIDC_ISSUER) : '',
        clientId: isAuthEnabled ? required('OIDC_CLIENT_ID', process.env.OIDC_CLIENT_ID) : '',
        clientSecret: isAuthEnabled ? required('OIDC_CLIENT_SECRET', process.env.OIDC_CLIENT_SECRET) : '',
        allowedGroup: process.env.OIDC_ALLOWED_GROUP ?? '',
    },
};

if (isAuthEnabled && appConfig.auth.sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters.');
}

export const hasProvider = {
    openai: openAiKey.length > 0,
    bfl: bflKey.length > 0,
};

export default appConfig;
