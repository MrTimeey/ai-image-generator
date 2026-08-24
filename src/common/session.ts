import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import appConfig from './appConfig';

export const SESSION_COOKIE = 'aig_session';
export const FLOW_COOKIE = 'aig_oidc';
const SESSION_MAX_AGE_DAYS = 7;
export const FLOW_MAX_AGE_SECONDS = 10 * 60;

/**
 * Die Sitzung ist ein **signiertes Cookie**, kein Server-Store. Bei einer
 * Handvoll Konten waere jede Tabelle dafuer Ballast; der Preis ist, dass eine
 * Sitzung nur ueber `SESSION_SECRET` global widerrufbar ist.
 */
export type SessionUser = {
    sub: string;
    username: string;
    name: string;
    groups: string[];
    email?: string;
    /**
     * Nur fuer `id_token_hint` beim Abmelden. Authentik verlangt es, sobald
     * `post_logout_redirect_uri` mitkommt.
     */
    idToken?: string;
};

/**
 * Jenseits von 4 KB verwirft der Browser das Cookie **stillschweigend** und die
 * Anmeldung liefe ins Leere. Der Preis ist allein, dass das Abmelden dann auf
 * Authentiks Seite endet statt zurueck in der App.
 */
const MAX_ID_TOKEN_CHARS = 2500;

export type Caller =
    | { kind: 'session'; user: SessionUser }
    | { kind: 'apiKey'; keyId: string; name: string };

export const setSessionCookie = (res: Response, user: SessionUser): void => {
    const payload: SessionUser = {
        ...user,
        idToken: user.idToken && user.idToken.length <= MAX_ID_TOKEN_CHARS ? user.idToken : undefined,
    };
    const token = jwt.sign(payload, appConfig.auth.sessionSecret, {
        expiresIn: `${SESSION_MAX_AGE_DAYS}d`,
    });
    res.cookie(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: appConfig.isProduction,
        path: '/',
        maxAge: SESSION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000,
    });
};

export const readSession = (req: Request): SessionUser | null => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) return null;
    try {
        const payload = jwt.verify(token, appConfig.auth.sessionSecret) as SessionUser & { exp: number };
        return {
            sub: payload.sub,
            username: payload.username,
            name: payload.name,
            groups: payload.groups ?? [],
            email: payload.email,
            idToken: payload.idToken,
        };
    } catch {
        return null;
    }
};

export const clearSessionCookie = (res: Response): void => {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
};

export type FlowState = { verifier: string; state: string; nonce: string; next: string; retry: boolean };

export const setFlowCookie = (res: Response, flow: FlowState): void => {
    const token = jwt.sign(flow, appConfig.auth.sessionSecret, { expiresIn: FLOW_MAX_AGE_SECONDS });
    res.cookie(FLOW_COOKIE, token, {
        httpOnly: true,
        // Pflicht: das Cookie muss die Rueckkehr von Authentik ueberleben, und
        // die ist eine fremde Navigation.
        sameSite: 'lax',
        secure: appConfig.isProduction,
        path: '/auth',
        maxAge: FLOW_MAX_AGE_SECONDS * 1000,
    });
};

export const readFlowCookie = (req: Request): FlowState | null => {
    const token = req.cookies?.[FLOW_COOKIE];
    if (!token) return null;
    try {
        return jwt.verify(token, appConfig.auth.sessionSecret) as FlowState;
    } catch {
        return null;
    }
};

export const clearFlowCookie = (res: Response): void => {
    res.clearCookie(FLOW_COOKIE, { path: '/auth' });
};

/** Nur App-interne Ziele — ein `next` von aussen waere eine offene Weiterleitung. */
export const safeNext = (value: unknown): string => {
    if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/';
    return value;
};
