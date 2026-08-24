import type * as OidcClient from 'openid-client';
import appConfig from './appConfig';

/**
 * `openid-client` v6 ist reines ESM, die App laeuft als CommonJS. Ein
 * `await import()` wuerde TypeScript unter `module: commonjs` zu `require()`
 * uebersetzen und beim Start mit `ERR_REQUIRE_ESM` scheitern — der Umweg ueber
 * `new Function` haelt den echten dynamischen Import am Leben.
 */
const importOidc = new Function('specifier', 'return import(specifier)') as (
    specifier: string
) => Promise<typeof OidcClient>;

let modulePromise: Promise<typeof OidcClient> | null = null;
export const oidcModule = (): Promise<typeof OidcClient> => {
    modulePromise ??= importOidc('openid-client');
    return modulePromise;
};

let discovered: Promise<OidcClient.Configuration> | null = null;

/**
 * Die Discovery laeuft **beim ersten Login**, nicht beim Start: sonst haengt
 * der Start der App an der Erreichbarkeit von Authentik, und ein Neustart
 * beider Container waere ein Rennen. Ein Fehlschlag wird nicht gemerkt, damit
 * eine kurze Stoerung die Anmeldung nicht dauerhaft lahmlegt.
 */
export const oidcConfig = (): Promise<OidcClient.Configuration> => {
    discovered ??= oidcModule()
        .then(oidc =>
            oidc.discovery(
                new URL(appConfig.auth.issuer),
                appConfig.auth.clientId,
                appConfig.auth.clientSecret
            )
        )
        .catch((error: unknown) => {
            discovered = null;
            throw error;
        });
    return discovered;
};

/**
 * Authentiks Selbstbedienung, aus dem Issuer abgeleitet — dort aendert der
 * Nutzer sein Passwort. Leer, wenn der Issuer unbrauchbar ist.
 */
export const accountUrl = (): string => {
    if (!appConfig.auth.issuer) return '';
    try {
        return new URL('/if/user/', appConfig.auth.issuer).href;
    } catch {
        return '';
    }
};
