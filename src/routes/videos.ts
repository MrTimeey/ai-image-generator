import express from 'express';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { hasProvider } from '../common/appConfig';
import { describeError, ProviderError, statusOf } from '../common/providerError';
import {
    DataVideo,
    findVideo,
    keyframePath,
    listVideos,
    posterPath,
    removeVideo,
    updateVideo,
    videoPath,
} from '../common/videoStore';
import {
    acceptKeyframes,
    durationLimit,
    enhanceDraft,
    ensurePoster,
    ENABLED_MODES,
    keyframeErrors,
    MAX_KEYFRAMES,
    startVideo,
    VIDEO_PRICES,
    VIDEO_RATIOS,
    VIDEO_RESOLUTIONS,
} from '../controller/videoService';

const videos: express.Router = express.Router();

const ResolutionSchema = z.enum(['hd', 'fhd', 'qhd', 'uhd']);

export const VideoSchema = z.object({
    mode: z.enum(['t2v', 'i2v', 'v2v']),
    prompt: z.string().trim().min(1, 'prompt darf nicht leer sein').max(8000),
    aspectRatio: z.enum(VIDEO_RATIOS).optional().default('auto'),
    duration: z.union([z.number().int().min(5).max(20), z.literal('auto')]).optional().default('auto'),
    /** Nur ohne Entwurf; ein Entwurf ist immer hd. */
    resolution: ResolutionSchema.optional().default('fhd'),
    /** Standard: erst ein Entwurf. Er kostet ein Drittel und lässt sich fertig rendern. */
    draft: z.boolean().optional().default(true),
    generateAudio: z.boolean().optional().default(true),
    /**
     * Bilder zu Video: ein Dateiname aus dem Bestand oder base64 (roh oder als
     * `data:`-URL), optional mit Sekunde. Ohne Sekunden: eins startet, zwei
     * sind Anfang und Ende, mehr verteilen sich gleichmäßig.
     */
    keyframes: z
        .array(z.object({ image: z.string().min(1), time: z.number().min(0).max(20).optional() }).strict())
        .max(MAX_KEYFRAMES)
        .optional(),
    /** Video fortsetzen: die Id eines fertigen Videos. */
    startVideo: z.string().uuid().optional(),
});

/** Wie Oberfläche und CLI einen Eintrag sehen. */
const alsPayload = (video: DataVideo) => ({
    ...video,
    pollingUrl: undefined,
    url: video.fileName ? `/api/videos/${video.id}/file` : null,
    poster: video.fileName ? `/api/videos/${video.id}/poster` : null,
    keyframes: video.keyframes?.map(frame => ({
        ...frame,
        url: frame.source === 'library' ? `/thumbnails/${frame.image}` : `/api/videos/keyframe/${frame.image}`,
    })),
    canEnhance: video.draft && video.status === 'done' && Boolean(video.draftCache),
});

const fehler = (res: express.Response, error: unknown, fallback = 'video_failed') =>
    res.status(statusOf(error)).send({
        error: error instanceof ProviderError ? error.code : fallback,
        message: describeError(error),
    });

/** Was die Oberfläche zum Aufbau braucht — eine Quelle für Grenzen und Preise. */
videos.get('/options', (_req, res) => {
    res.send({
        available: hasProvider.bfl,
        modes: ENABLED_MODES,
        ratios: VIDEO_RATIOS,
        resolutions: VIDEO_RESOLUTIONS,
        prices: VIDEO_PRICES,
        maxKeyframes: MAX_KEYFRAMES,
        durations: { t2v: durationLimit('t2v'), i2v: durationLimit('i2v'), v2v: durationLimit('v2v') },
    });
});

videos.get('/', (_req, res) => {
    res.send({ videos: listVideos().map(alsPayload) });
});

videos.get('/keyframe/:name', (req, res) => {
    const name = path.basename(req.params.name);
    if (name !== req.params.name || !/^[A-Za-z0-9._-]+\.jpg$/.test(name) || !fs.existsSync(keyframePath(name))) {
        return res.status(404).send({ error: 'not_found', message: 'Keyframe nicht gefunden.' });
    }
    res.sendFile(path.resolve(keyframePath(name)));
});

videos.get('/:id', (req, res) => {
    const video = findVideo(req.params.id);
    if (!video) return res.status(404).send({ error: 'not_found', message: 'Video nicht gefunden.' });
    res.send(alsPayload(video));
});

/** `sendFile` beantwortet Range-Anfragen — ohne die ließe sich im Video nicht springen. */
videos.get('/:id/file', (req, res) => {
    const video = findVideo(req.params.id);
    if (!video?.fileName || !fs.existsSync(videoPath(video.fileName))) {
        return res.status(404).send({ error: 'not_found', message: 'Video nicht gefunden.' });
    }
    if (req.query.download === '1') return res.download(path.resolve(videoPath(video.fileName)));
    res.sendFile(path.resolve(videoPath(video.fileName)));
});

/** Das Standbild; für Videos von vor dieser Änderung beim ersten Abruf erzeugt. */
videos.get('/:id/poster', async (req, res) => {
    const video = findVideo(req.params.id);
    if (!video?.fileName || !(await ensurePoster(video))) {
        return res.status(404).send({ error: 'not_found', message: 'Kein Standbild.' });
    }
    res.sendFile(path.resolve(posterPath(video.id)));
});

videos.post('/', async (req, res) => {
    const parsed = VideoSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).send({
            error: 'invalid_request',
            message: parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; '),
        });
    }
    if (!hasProvider.bfl) {
        return res.status(503).send({ error: 'provider_not_configured', message: 'Für Video braucht es einen BFL-Schlüssel.' });
    }
    const anfrage = parsed.data;
    if (!ENABLED_MODES.includes(anfrage.mode)) {
        return res.status(400).send({
            error: 'mode_disabled',
            message: `„${anfrage.mode}" ist derzeit abgeschaltet. Möglich: ${ENABLED_MODES.join(', ')}.`,
        });
    }
    const grenze = durationLimit(anfrage.mode);
    if (anfrage.duration !== 'auto' && anfrage.duration > grenze.max) {
        return res.status(400).send({ error: 'invalid_duration', message: `Höchstens ${grenze.max} s in diesem Modus.` });
    }
    if (anfrage.mode === 'i2v') {
        const probleme = keyframeErrors(anfrage.keyframes ?? [], anfrage.duration);
        if (probleme.length > 0) return res.status(400).send({ error: 'invalid_keyframes', message: probleme.join(' ') });
    } else if (anfrage.keyframes?.length) {
        return res.status(400).send({ error: 'invalid_request', message: 'keyframes gibt es nur bei mode „i2v".' });
    }
    if (anfrage.mode === 'v2v') {
        const quelle = anfrage.startVideo ? findVideo(anfrage.startVideo) : undefined;
        if (!quelle || quelle.status !== 'done') {
            return res.status(400).send({ error: 'invalid_start_video', message: 'startVideo muss ein fertiges Video sein.' });
        }
    }
    try {
        const keyframes = anfrage.mode === 'i2v' ? await acceptKeyframes(anfrage.keyframes ?? []) : undefined;
        const video = startVideo({ ...anfrage, keyframes, startVideo: anfrage.mode === 'v2v' ? anfrage.startVideo : undefined });
        // 202: angenommen, fertig wird es im Hintergrund. Abholen über GET /api/videos/:id.
        res.status(202).send(alsPayload(video));
    } catch (error) {
        fehler(res, error);
    }
});

videos.post('/:id/enhance', (req, res) => {
    const parsed = z.object({ resolution: ResolutionSchema.optional().default('fhd') }).safeParse(req.body ?? {});
    if (!parsed.success) {
        return res.status(400).send({ error: 'invalid_request', message: 'resolution: hd, fhd, qhd oder uhd.' });
    }
    try {
        res.status(202).send(alsPayload(enhanceDraft(req.params.id, parsed.data.resolution)));
    } catch (error) {
        fehler(res, error);
    }
});

videos.put('/:id/favorite', (req, res) => {
    const parsed = z.object({ favorite: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).send({ error: 'invalid_request', message: 'Feld `favorite` fehlt.' });
    const video = updateVideo(req.params.id, { favorite: parsed.data.favorite || undefined });
    if (!video) return res.status(404).send({ error: 'not_found', message: 'Video nicht gefunden.' });
    res.send(alsPayload(video));
});

videos.delete('/:id', (req, res) => {
    const video = findVideo(req.params.id);
    if (!video) return res.status(404).send({ error: 'not_found', message: 'Video nicht gefunden.' });
    if (video.status === 'running') {
        // Der Lauf ist bezahlt und schreibt gleich in diesen Eintrag.
        return res.status(409).send({ error: 'still_running', message: 'Das Video entsteht noch — erst danach löschen.' });
    }
    removeVideo(video.id);
    res.send({ id: video.id, deleted: true });
});

export default videos;
