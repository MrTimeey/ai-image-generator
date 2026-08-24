import { NextFunction, Request, Response } from 'express';
import appConfig from './appConfig';
import { verifyApiKey } from './apiKeyStore';
import { Caller, readSession } from './session';

declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Express {
        interface Request {
            caller?: Caller;
        }
    }
}

/**
 * Ohne Anmeldung erreichbar. `/auth/*` muss frei sein, sonst gibt es keine
 * Anmeldung; `/sw.js` ebenfalls, weil der Browser die Registrierung eines
 * Service Workers abbricht, sobald sie auf eine Weiterleitung laeuft.
 */
const isPublic = (path: string): boolean =>
    path.startsWith('/auth/') ||
    path.startsWith('/public/') ||
    path === '/favicon.ico' ||
    path === '/sw.js' ||
    path === '/api/health';

const bearerToken = (req: Request): string | undefined => {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length).trim();
    const apiKeyHeader = req.headers['x-api-key'];
    if (typeof apiKeyHeader === 'string') return apiKeyHeader.trim();
    return undefined;
};

/**
 * Ein Tor fuer beide Zugangswege. Entscheidend ist die Antwort im Fehlerfall:
 * unter `/api` gibt es **401 als JSON**, sonst eine Weiterleitung zur
 * Anmeldung. Frueher wurde auch die API auf `/login.html` umgeleitet, sodass
 * ein Skript einen Anmeldefehler nicht von einer Antwort unterscheiden konnte.
 */
export const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
    if (isPublic(req.path)) return next();

    const token = bearerToken(req);
    if (token) {
        const key = verifyApiKey(token);
        if (key) {
            req.caller = { kind: 'apiKey', keyId: key.id, name: key.name };
            return next();
        }
        // Ein mitgeschickter, aber ungueltiger Schluessel ist nie ein Grund,
        // auf die Anmeldeseite umzuleiten.
        res.status(401).send({
            error: 'invalid_api_key',
            message: 'Der API-Key ist unbekannt, abgelaufen oder widerrufen.',
        });
        return;
    }

    const session = readSession(req);
    if (session) {
        req.caller = { kind: 'session', user: session };
        return next();
    }

    // Mit Schraegstrich: `/api-keys.html` ist eine Seite und gehoert zur
    // Anmeldung weitergeleitet, nicht mit 401 JSON abgewiesen.
    if (req.path.startsWith('/api/')) {
        res.status(401).send({
            error: 'unauthorized',
            message: 'Anmeldung nötig. Für Skripte einen API-Key unter /api-keys.html erzeugen.',
        });
        return;
    }
    res.redirect(`/auth/login?next=${encodeURIComponent(req.originalUrl)}`);
};

/** Nur mit Sitzung: ein API-Key darf keine weiteren API-Keys erzeugen. */
export const requireSession = (req: Request, res: Response, next: NextFunction): void => {
    if (!appConfig.enableAuth) return next();
    if (req.caller?.kind === 'session') return next();
    res.status(403).send({
        error: 'session_required',
        message: 'Schlüssel lassen sich nur in der angemeldeten Oberfläche verwalten.',
    });
};

export const callerName = (req: Request): string => {
    if (req.caller?.kind === 'session') return req.caller.user.username;
    if (req.caller?.kind === 'apiKey') return `api-key:${req.caller.name}`;
    return 'anonymous';
};
