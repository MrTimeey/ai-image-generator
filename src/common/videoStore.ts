import fs from 'fs';
import path from 'path';
import appConfig from './appConfig';

/**
 * Die Videos haben einen **eigenen** Bestand neben `data.json`: eigener
 * Ordner, eigene `videos.json`. Übersicht, Export und Aufräumen der Bilder
 * kennen nur Bilder — ein Video dort hineinzumischen hätte jede dieser
 * Stellen berührt. `cleanDataStore` sieht nur Dateien im Wurzelordner, der
 * Unterordner `videos/` bleibt ihm verborgen.
 */
export const VIDEO_DIR = 'videos';
export const KEYFRAME_DIR = 'keyframes';

export type VideoMode = 't2v' | 'i2v' | 'v2v' | 'draft_enhance';
export type VideoResolution = 'hd' | 'fhd' | 'qhd' | 'uhd';

/** Ein Bild, das zu einem Frame des Videos wird. */
export type VideoKeyframe = {
    /** Dateiname — im Bildbestand (`library`) oder unter `videos/keyframes/` (`upload`). */
    image: string;
    source: 'library' | 'upload';
    /** Sekunde, an der das Bild im Video steht. Fehlt = gleichmäßig verteilt. */
    time?: number;
};

export type DataVideo = {
    id: string;
    createdAt: string;
    /**
     * Ein Video entsteht in ein bis drei Minuten. Der Eintrag wird schon beim
     * Absenden angelegt (`running`, mit `pollingUrl`), damit ein Neustart —
     * also jedes Deployment — einen bezahlten Auftrag nicht verliert: beim
     * Start wird weitergepollt.
     */
    status: 'running' | 'done' | 'error';
    mode: VideoMode;
    prompt: string;
    /** Was FLUX 3 aus dem Prompt gemacht hat — es formuliert immer aus. */
    revisedPrompt?: string;
    /** Schnelle hd-Vorschau mit `draftCache`, die sich fertig rendern lässt. */
    draft: boolean;
    resolution: VideoResolution;
    aspectRatio: string;
    duration: number | 'auto';
    generateAudio: boolean;
    keyframes?: VideoKeyframe[];
    /** v2v: die Id des Videos, das fortgesetzt wird. */
    startVideo?: string;
    /** draft_enhance: die Id des Entwurfs, der hier fertig gerendert wurde. */
    enhancedFrom?: string;
    pollingUrl?: string;
    fileName?: string;
    /** Dateiname des Entwurfs-Bündels unter `videos/`. Nur bei Entwürfen. */
    draftCache?: string;
    cost?: number;
    costUnit?: 'credits' | 'usd';
    /** `true`, wenn die Kosten aus der Preisliste geschätzt sind statt gemeldet. */
    costEstimated?: boolean;
    /** Laufzeit des Videos in Sekunden, wie BFL sie meldet. */
    seconds?: number;
    /** Wie lange der Auftrag gedauert hat. */
    durationMs?: number;
    startedAt: number;
    error?: string;
    errorCode?: string;
    favorite?: boolean;
};

type VideoStore = { videos: DataVideo[] };

export const videoDir = (): string => path.join(appConfig.baseFolder, VIDEO_DIR);
export const videoPath = (fileName: string): string => path.join(videoDir(), fileName);
export const keyframePath = (fileName: string): string => path.join(videoDir(), KEYFRAME_DIR, fileName);
/** Standbild eines Videos, `<id>.jpg` neben dem MP4. */
export const posterPath = (id: string): string => path.join(videoDir(), `${id}.jpg`);

const storePath = (): string => path.join(videoDir(), 'videos.json');

let cache: VideoStore | null = null;

const read = (): VideoStore => {
    if (cache) return cache;
    const file = storePath();
    if (!fs.existsSync(file)) {
        cache = { videos: [] };
        return cache;
    }
    try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as VideoStore;
        cache = { videos: Array.isArray(parsed?.videos) ? parsed.videos : [] };
    } catch (error) {
        // Wie bei data.json: beiseitelegen statt den Dienst nicht hochkommen zu lassen.
        const broken = `${file}.kaputt-${Date.now()}`;
        try {
            fs.renameSync(file, broken);
        } catch {
            // nichts zu retten
        }
        console.error(`videos.json ist unlesbar (${error}), beiseitegelegt als ${broken}.`);
        cache = { videos: [] };
    }
    return cache;
};

/** Daneben schreiben, dann umbenennen — ein Container-Stop hinterlässt keine halbe Datei. */
const write = (store: VideoStore): void => {
    fs.mkdirSync(videoDir(), { recursive: true });
    const file = storePath();
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(store, null, 2), 'utf8');
    fs.renameSync(`${file}.tmp`, file);
    cache = store;
};

/** Neueste zuerst. */
export const listVideos = (): DataVideo[] =>
    [...read().videos].sort((a, b) => b.startedAt - a.startedAt);

export const findVideo = (id: string): DataVideo | undefined => read().videos.find(video => video.id === id);

export const addVideo = (video: DataVideo): void => {
    const store = read();
    write({ videos: [...store.videos, video] });
};

export const updateVideo = (id: string, patch: Partial<DataVideo>): DataVideo | undefined => {
    const store = read();
    const video = store.videos.find(entry => entry.id === id);
    if (!video) return undefined;
    Object.assign(video, patch);
    write(store);
    return video;
};

/** Entfernt Eintrag, Videodatei, Entwurfs-Bündel und hochgeladene Keyframes. */
export const removeVideo = (id: string): boolean => {
    const store = read();
    const video = store.videos.find(entry => entry.id === id);
    if (!video) return false;
    write({ videos: store.videos.filter(entry => entry.id !== id) });
    const dateien = [
        video.fileName && videoPath(video.fileName),
        video.draftCache && videoPath(video.draftCache),
        posterPath(video.id),
        ...(video.keyframes ?? []).filter(k => k.source === 'upload').map(k => keyframePath(k.image)),
    ].filter((datei): datei is string => Boolean(datei));
    for (const datei of dateien) {
        if (fs.existsSync(datei)) fs.rmSync(datei);
    }
    return true;
};

/** Nur für Tests: den Speicher vergessen. */
export const resetVideoCache = (): void => {
    cache = null;
};
