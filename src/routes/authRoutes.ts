import express from 'express';
import appConfig from '../common/appConfig';
import { accountUrl, oidcConfig, oidcModule } from '../common/oidc';
import {
    clearFlowCookie,
    clearSessionCookie,
    readFlowCookie,
    readSession,
    safeNext,
    setFlowCookie,
    setSessionCookie,
    SessionUser,
} from '../common/session';

const authRoutes: express.Router = express.Router();

const SCOPE = 'openid profile email';

const asStringArray = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

const escapeHtml = (value: string): string =>
    value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

const page = (title: string, body: string): string => `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link href="/public/css/generated-tailwind.css" rel="stylesheet"></head>
<body class="bg-gray-100 flex items-center justify-center min-h-screen p-6">
<main class="bg-white rounded-lg shadow p-8 max-w-lg">
<h1 class="text-2xl font-semibold text-gray-800 mb-3">${escapeHtml(title)}</h1>
<p class="text-gray-600">${body}</p>
<p class="mt-6"><a class="text-blue-600 hover:underline" href="/auth/login">Noch einmal anmelden</a></p>
</main></body></html>`;

authRoutes.get('/login', async (req, res) => {
    const next = safeNext(req.query.next);
    try {
        const oidc = await oidcModule();
        const verifier = oidc.randomPKCECodeVerifier();
        const state = oidc.randomState();
        const nonce = oidc.randomNonce();

        const url = oidc.buildAuthorizationUrl(await oidcConfig(), {
            redirect_uri: `${appConfig.publicBaseUrl}/auth/callback`,
            scope: SCOPE,
            state,
            nonce,
            code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
            code_challenge_method: 'S256',
        });

        setFlowCookie(res, { verifier, state, nonce, next, retry: req.query.retry === '1' });
        return res.redirect(url.href);
    } catch (error) {
        console.error('Authentik nicht erreichbar:', error);
        return res
            .status(503)
            .type('text/html; charset=utf-8')
            .send(page('Anmeldung nicht möglich', 'Authentik ist gerade nicht erreichbar. Bitte später erneut versuchen.'));
    }
});

authRoutes.get('/callback', async (req, res) => {
    // Authentik meldet Fehler ueber die Rueckkehr-URL, nicht ueber einen
    // Statuscode. Diese Abzweigung muss **vor** dem Cookie-Test stehen: bei
    // dauerhafter Fehlkonfiguration ist das Flow-Cookie schon weg, und der
    // Neustart des Logins waere eine Schleife.
    const failure = req.query as { error?: string; error_description?: string };
    if (failure.error) {
        clearFlowCookie(res);
        console.error('Authentik hat die Anmeldung abgelehnt:', failure);
        return res
            .status(502)
            .type('text/html; charset=utf-8')
            .send(
                page(
                    'Anmeldung fehlgeschlagen',
                    `Authentik hat die Anmeldung abgelehnt: ${escapeHtml(
                        failure.error_description ?? failure.error
                    )} (<code>${escapeHtml(failure.error)}</code>). Das ist eine Frage der Provider-Konfiguration, nicht des Kontos.`
                )
            );
    }

    const flow = readFlowCookie(req);
    if (!flow) {
        // Meist ein alter Tab oder ein Reload der Callback-URL.
        return res.redirect('/auth/login');
    }
    clearFlowCookie(res);

    try {
        const oidc = await oidcModule();
        const config = await oidcConfig();
        const currentUrl = new URL(req.originalUrl, appConfig.publicBaseUrl);
        const tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
            pkceCodeVerifier: flow.verifier,
            expectedState: flow.state,
            expectedNonce: flow.nonce,
        });

        const claims = tokens.claims();
        if (!claims) {
            throw new Error('Authentik hat kein ID-Token geliefert.');
        }

        let groups = asStringArray((claims as { groups?: unknown }).groups);
        if (groups.length === 0) {
            // Fehlen die Gruppen im ID-Token, hat der Provider
            // `include_claims_in_id_token` aus — dann `userinfo` nachladen.
            const info = await oidc.fetchUserInfo(config, tokens.access_token, claims.sub);
            groups = asStringArray((info as { groups?: unknown }).groups);
        }

        const required = appConfig.auth.allowedGroup;
        if (required && !groups.includes(required)) {
            console.warn('Anmeldung ohne passende Gruppe abgelehnt:', claims.sub, groups);
            return res
                .status(403)
                .type('text/html; charset=utf-8')
                .send(
                    page(
                        'Kein Zugriff',
                        `Dieses Konto ist nicht in der Gruppe <code>${escapeHtml(required)}</code>.`
                    )
                );
        }

        const username = typeof claims.preferred_username === 'string' ? claims.preferred_username : claims.sub;
        const user: SessionUser = {
            sub: claims.sub,
            username,
            name: typeof claims.name === 'string' ? claims.name : username,
            groups,
            // Leerer String zaehlt als „keine" — Authentik liefert ihn so.
            email: typeof claims.email === 'string' && claims.email ? claims.email : undefined,
            idToken: tokens.id_token,
        };
        setSessionCookie(res, user);
        return res.redirect(flow.next);
    } catch (error) {
        /**
         * Haeufigster Fall ist ein **ueberholter Flow**: ein zweiter Anmeldelauf
         * hat das Cookie ueberschrieben, `state` passt nicht mehr. Einmal frisch
         * anfangen loest das; eine 500 waere hier eine Sackgasse.
         */
        console.warn('Rückkehr von Authentik nicht verwertbar:', error);
        if (!flow.retry) {
            return res.redirect(`/auth/login?retry=1&next=${encodeURIComponent(flow.next)}`);
        }
        return res
            .status(502)
            .type('text/html; charset=utf-8')
            .send(page('Anmeldung fehlgeschlagen', 'Die Rückkehr von Authentik ließ sich auch beim zweiten Versuch nicht verwerten. Ein Neuladen hilft hier nicht — ins Log sehen.'));
    }
});

/**
 * Abmelden beendet **beide** Sitzungen: unser Cookie faellt, danach uebernimmt
 * Authentiks Logout-Flow. Nur das Cookie zu loeschen wuerde eine neue Anmeldung
 * ohne Passwort durchwinken — das waere kein Abmelden.
 */
authRoutes.get('/logout', async (req, res) => {
    // Vor dem Loeschen lesen: das ID-Token steckt im Cookie.
    const session = readSession(req);
    clearSessionCookie(res);

    try {
        const endSession = (await oidcConfig()).serverMetadata().end_session_endpoint;
        if (endSession) {
            const url = new URL(endSession);
            /**
             * `post_logout_redirect_uri` **nur zusammen mit** `id_token_hint`.
             * Authentik lehnt die Angabe sonst mit 400 ab, und zwar bevor die
             * Sitzung endet — das Abmelden saehe nach einem Fehler aus und
             * liesse den Nutzer in Wahrheit angemeldet.
             */
            if (session?.idToken) {
                url.searchParams.set('id_token_hint', session.idToken);
                url.searchParams.set('post_logout_redirect_uri', appConfig.publicBaseUrl);
            }
            return res.redirect(url.href);
        }
    } catch (error) {
        console.warn('Logout-Endpunkt nicht erreichbar, nur Cookie geloescht:', error);
    }
    return res.redirect('/');
});

authRoutes.get('/me', (req, res) => {
    if (!appConfig.enableAuth) {
        return res.send({ authenticated: false, authEnabled: false, name: 'Entwicklung', accountUrl: '' });
    }
    const session = readSession(req);
    if (!session) return res.status(401).send({ error: 'unauthorized' });
    res.send({
        authenticated: true,
        authEnabled: true,
        username: session.username,
        name: session.name,
        email: session.email,
        groups: session.groups,
        accountUrl: accountUrl(),
    });
});

export default authRoutes;
