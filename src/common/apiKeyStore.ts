import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import appConfig from './appConfig';

/**
 * Selbstverwaltete Schluessel fuer den Skript-Zugriff. Bewusst neben
 * `data.json` als eigene Datei und nicht in Authentik: so bleibt die API auch
 * dann bedienbar, wenn Authentik gerade nicht erreichbar ist, und ein
 * einzelner Schluessel laesst sich widerrufen, ohne ein Konto anzufassen.
 */
export type ApiKeyRecord = {
    id: string;
    name: string;
    /** Die ersten Zeichen im Klartext, damit ein Eintrag wiedererkennbar ist. */
    prefix: string;
    hash: string;
    createdAt: string;
    createdBy: string;
    lastUsedAt?: string;
    /** ISO-Zeitpunkt. Fehlt er, gilt der Schluessel unbegrenzt. */
    expiresAt?: string;
};

type ApiKeyStore = { keys: ApiKeyRecord[] };

const STORE_NAME = 'api-keys.json';
const KEY_PREFIX = 'aig_';
/** Der Klartext wird nie gespeichert — nur dieser Hash. */
const hashKey = (raw: string): string => crypto.createHash('sha256').update(raw).digest('hex');

const storePath = (): string => path.join(appConfig.baseFolder, STORE_NAME);

const readStore = (): ApiKeyStore => {
    const file = storePath();
    if (!fs.existsSync(file)) return { keys: [] };
    try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as ApiKeyStore;
        return { keys: Array.isArray(parsed.keys) ? parsed.keys : [] };
    } catch (error) {
        console.error('api-keys.json ist unlesbar, wird als leer behandelt:', error);
        return { keys: [] };
    }
};

const writeStore = (store: ApiKeyStore): void => {
    if (!fs.existsSync(appConfig.baseFolder)) {
        fs.mkdirSync(appConfig.baseFolder, { recursive: true });
    }
    // Erst daneben schreiben, dann umbenennen: ein abgebrochener Schreibvorgang
    // darf nicht alle Schluessel entwerten.
    const file = storePath();
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, file);
};

export const isExpired = (key: Pick<ApiKeyRecord, 'expiresAt'>, now = Date.now()): boolean =>
    Boolean(key.expiresAt) && Date.parse(key.expiresAt as string) <= now;

export type PublicApiKey = Omit<ApiKeyRecord, 'hash'> & { expired: boolean };

export const listApiKeys = (): PublicApiKey[] =>
    readStore()
        .keys.map(({ hash: _hash, ...rest }) => ({ ...rest, expired: isExpired(rest) }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

export const createApiKey = (
    name: string,
    createdBy: string,
    /** Gueltigkeit in Tagen. 0 oder nichts heisst: unbegrenzt. */
    expiresInDays?: number
): { record: PublicApiKey; secret: string } => {
    const secret = KEY_PREFIX + crypto.randomBytes(32).toString('base64url');
    const record: ApiKeyRecord = {
        id: crypto.randomUUID(),
        name: name.trim() || 'unbenannt',
        prefix: secret.slice(0, KEY_PREFIX.length + 6),
        hash: hashKey(secret),
        createdAt: new Date().toISOString(),
        createdBy,
        expiresAt:
            expiresInDays && expiresInDays > 0
                ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString()
                : undefined,
    };
    const store = readStore();
    store.keys.push(record);
    writeStore(store);
    const { hash: _hash, ...rest } = record;
    return { record: { ...rest, expired: false }, secret };
};

export const revokeApiKey = (id: string): boolean => {
    const store = readStore();
    const before = store.keys.length;
    store.keys = store.keys.filter(key => key.id !== id);
    if (store.keys.length === before) return false;
    writeStore(store);
    return true;
};

/** Damit nicht jeder API-Aufruf die Datei neu schreibt. */
const LAST_USED_THROTTLE_MS = 60_000;
const lastWritten = new Map<string, number>();

export const verifyApiKey = (raw: string | undefined): ApiKeyRecord | null => {
    if (!raw || !raw.startsWith(KEY_PREFIX)) return null;
    const digest = Buffer.from(hashKey(raw), 'hex');
    const store = readStore();

    for (const key of store.keys) {
        const candidate = Buffer.from(key.hash, 'hex');
        if (candidate.length !== digest.length) continue;
        if (!crypto.timingSafeEqual(candidate, digest)) continue;

        const now = Date.now();
        // Abgelaufen zaehlt wie nicht vorhanden. Der Eintrag bleibt aber
        // stehen, damit in der Liste sichtbar ist, warum ein Skript scheitert.
        if (isExpired(key, now)) return null;
        if ((lastWritten.get(key.id) ?? 0) + LAST_USED_THROTTLE_MS < now) {
            lastWritten.set(key.id, now);
            key.lastUsedAt = new Date().toISOString();
            writeStore(store);
        }
        return key;
    }
    return null;
};
