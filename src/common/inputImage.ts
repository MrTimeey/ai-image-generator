import { ProviderError } from './providerError';

/** Referenzbilder kommen als base64 herein — mit oder ohne `data:`-Praefix. */
const DATA_URL = /^data:image\/(png|jpe?g|webp);base64,/i;

/** 8 MB je Bild, roh gerechnet. Darueber lehnen beide Anbieter ohnehin ab. */
const MAX_BYTES = 8 * 1024 * 1024;

export type InputImage = { base64: string; buffer: Buffer; mimeType: string };

export const parseInputImage = (value: string, index: number): InputImage => {
    const position = `Referenzbild ${index + 1}`;
    let mimeType = 'image/png';
    let payload = value.trim();

    const match = DATA_URL.exec(payload);
    if (match) {
        mimeType = `image/${match[1].toLowerCase() === 'jpg' ? 'jpeg' : match[1].toLowerCase()}`;
        payload = payload.slice(match[0].length);
    }
    payload = payload.replace(/\s+/g, '');
    if (!payload) {
        throw new ProviderError(400, 'invalid_input_image', `${position} ist leer.`);
    }

    let buffer: Buffer;
    try {
        buffer = Buffer.from(payload, 'base64');
    } catch {
        throw new ProviderError(400, 'invalid_input_image', `${position} ist kein gültiges base64.`);
    }
    // Buffer.from verschluckt Unsinn stillschweigend — deshalb gegenpruefen.
    if (buffer.length === 0) {
        throw new ProviderError(400, 'invalid_input_image', `${position} liess sich nicht dekodieren.`);
    }
    if (buffer.length > MAX_BYTES) {
        throw new ProviderError(
            413,
            'input_image_too_large',
            `${position} ist ${(buffer.length / 1024 / 1024).toFixed(1)} MB groß, erlaubt sind ${MAX_BYTES / 1024 / 1024} MB.`
        );
    }
    if (!looksLikeImage(buffer)) {
        throw new ProviderError(400, 'invalid_input_image', `${position} ist kein PNG, JPEG oder WebP.`);
    }
    return { base64: payload, buffer, mimeType: mimeType === 'image/png' ? detectMime(buffer) : mimeType };
};

const detectMime = (buffer: Buffer): string => {
    if (buffer.subarray(0, 3).toString('hex') === 'ffd8ff') return 'image/jpeg';
    if (buffer.subarray(0, 4).toString('ascii') === 'RIFF') return 'image/webp';
    return 'image/png';
};

/** Magic Bytes statt Vertrauen in den mitgelieferten Typ. */
const looksLikeImage = (buffer: Buffer): boolean => {
    if (buffer.length < 12) return false;
    const png = buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
    const jpeg = buffer.subarray(0, 3).toString('hex') === 'ffd8ff';
    const webp =
        buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
        buffer.subarray(8, 12).toString('ascii') === 'WEBP';
    return png || jpeg || webp;
};
