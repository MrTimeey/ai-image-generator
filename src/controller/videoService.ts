import fs from 'fs';
import { execFile } from 'child_process';
import axios from 'axios';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import { currentTimestamp } from '../common/timeUtils';
import { imagePath } from '../common/fileUtils';
import { parseInputImage } from '../common/inputImage';
import { describeError, ProviderError } from '../common/providerError';
import {
    addVideo,
    DataVideo,
    findVideo,
    KEYFRAME_DIR,
    keyframePath,
    listVideos,
    posterPath,
    updateVideo,
    VideoKeyframe,
    VideoMode,
    VideoResolution,
    videoDir,
    videoPath,
} from '../common/videoStore';
import { pollUntilReady, submitTo } from './bflController';

/**
 * FLUX 3 Video (`POST /v1/flux-3-video`, seit 04.08.2026 als Preview).
 *
 * Ein Endpunkt, vier Modi: Text zu Video (`t2v`), Bilder zu Video (`i2v`,
 * Keyframes), Video fortsetzen (`v2v`) und einen Entwurf fertig rendern
 * (`draft_enhance`). Ein Entwurf ist eine schnelle hd-Vorschau für etwa ein
 * Drittel des Preises; sein `draft_cache`-Bündel reproduziert beim
 * Fertigrendern **dieselbe** Aufnahme — ein neuer Auftrag würde sie neu
 * interpretieren.
 */
export const VIDEO_ENDPOINT = 'flux-3-video';

/**
 * Welche Modi angeboten werden — ein Schalter, falls einer bei BFL hakt.
 * Fortsetzen war kurz aus, weil es mit „Insufficient credits" scheiterte; das
 * lag aber am leeren Konto, nicht am Modus (am 07.10.2026 danach erfolgreich
 * getestet: 5 s Entwurf, 60 Credits, 93 s).
 */
export const ENABLED_MODES: readonly ('t2v' | 'i2v' | 'v2v')[] = ['t2v', 'i2v', 'v2v'];

export const VIDEO_RATIOS = ['auto', '21:9', '2:1', '16:9', '4:3', '1:1', '3:4', '9:16', '9:21'] as const;
export const VIDEO_RESOLUTIONS: readonly VideoResolution[] = ['hd', 'fhd', 'qhd', 'uhd'];
export const MAX_KEYFRAMES = 10;

/** Laufzeitgrenzen in Sekunden; Fortsetzen geht nur bis 15. */
export const durationLimit = (mode: VideoMode): { min: number; max: number } =>
    mode === 'v2v' ? { min: 5, max: 15 } : { min: 5, max: 20 };

/**
 * Dollar je Sekunde, Stand BFL-Preisliste 07.10.2026. Für die Anzeige vorher
 * und als Rückfall: BFL meldet `cost` bei Videos nicht beim Absenden, sondern
 * erst beim Abholen (am 07.10.2026: 30 Credits für 5 s Entwurf — passt).
 */
export const VIDEO_PRICES: Record<'t2v' | 'i2v' | 'v2v', Record<VideoResolution | 'draft', number>> = {
    t2v: { hd: 0.17, fhd: 0.29, qhd: 0.4, uhd: 0.8, draft: 0.06 },
    i2v: { hd: 0.17, fhd: 0.29, qhd: 0.4, uhd: 0.8, draft: 0.06 },
    v2v: { hd: 0.41, fhd: 0.53, qhd: 0.65, uhd: 0.95, draft: 0.12 },
};

/**
 * Was ein Lauf kostet. Beim Fertigrendern eines Entwurfs zählt der Modus des
 * Entwurfs; Preis je Sekunde wie ein voller Lauf.
 */
export const estimateUsd = (
    mode: 't2v' | 'i2v' | 'v2v',
    resolution: VideoResolution,
    draft: boolean,
    seconds: number
): number => Math.round(VIDEO_PRICES[mode][draft ? 'draft' : resolution] * seconds * 100) / 100;

/** Ein Keyframe, wie er hereinkommt: ein Bild aus dem Bestand oder hochgeladen, optional mit Zeitpunkt. */
export type KeyframeInput = { image: string; time?: number };

/**
 * Was BFL an Keyframes verlangt — vorher prüfen, statt ein 422 zu bezahlen:
 *
 * - 1 bis 10 Bilder. Ohne Zeitpunkte: eins startet das Video, zwei sind
 *   Anfang und Ende, bei mehr verteilen sich die mittleren gleichmäßig —
 *   dann braucht es eine feste Dauer.
 * - Mit Zeitpunkten: alle oder keiner, aufsteigend, innerhalb der Dauer.
 *   Bei `auto` läuft das Video bis zum letzten Zeitpunkt (aufgerundet).
 */
export const keyframeErrors = (keyframes: readonly KeyframeInput[], duration: number | 'auto'): string[] => {
    const fehler: string[] = [];
    if (keyframes.length === 0) return ['Bilder zu Video braucht mindestens ein Bild.'];
    if (keyframes.length > MAX_KEYFRAMES) fehler.push(`Höchstens ${MAX_KEYFRAMES} Bilder, übergeben wurden ${keyframes.length}.`);

    const mitZeit = keyframes.filter(k => k.time !== undefined);
    if (mitZeit.length > 0 && mitZeit.length < keyframes.length) {
        fehler.push('Entweder alle Bilder mit Zeitpunkt oder keins.');
        return fehler;
    }
    if (mitZeit.length === 0) {
        if (keyframes.length >= 3 && duration === 'auto') {
            fehler.push('Ab drei Bildern ohne Zeitpunkte braucht das Video eine feste Dauer.');
        }
        return fehler;
    }
    const zeiten = keyframes.map(k => k.time as number);
    zeiten.forEach((zeit, i) => {
        if (zeit < 0 || zeit > 20) fehler.push(`Bild ${i + 1}: Zeitpunkt ${zeit} s liegt außerhalb von 0–20 s.`);
        if (i > 0 && zeit <= zeiten[i - 1]) fehler.push(`Bild ${i + 1}: die Zeitpunkte müssen aufsteigen.`);
    });
    const letzter = zeiten[zeiten.length - 1];
    if (duration !== 'auto' && letzter > duration) {
        fehler.push(`Der letzte Zeitpunkt (${letzter} s) liegt hinter dem Ende des Videos (${duration} s).`);
    }
    return fehler;
};

/** Wie lang das Video vermutlich wird — für die Preisschätzung vorher. */
export const expectedSeconds = (duration: number | 'auto', keyframes?: readonly KeyframeInput[]): number => {
    if (duration !== 'auto') return duration;
    const letzter = keyframes?.length ? keyframes[keyframes.length - 1].time : undefined;
    // Ohne Angabe wählt BFL selbst; 5 bis 10 s sind in den Beispielen üblich.
    return letzter !== undefined ? Math.min(20, Math.max(5, Math.ceil(letzter))) : 10;
};

/** Die Medien, schon als base64, die in den Rumpf gehören. */
export type VideoMedia = {
    keyframes?: { base64: string; time?: number }[];
    startVideo?: string;
    draftCache?: string;
};

/**
 * Der Rumpf je Modus. Das Schema verbietet unbekannte Felder (422), also nur,
 * was der jeweilige Modus kennt. Entwürfe rendern immer in `hd` — `draft`
 * zusammen mit einer anderen Auflösung lehnt BFL ab, daher fehlt sie dann.
 */
export const buildVideoBody = (video: DataVideo, media: VideoMedia): Record<string, unknown> => {
    if (video.mode === 'draft_enhance') {
        return { mode: 'draft_enhance', draft_cache: media.draftCache, resolution: video.resolution };
    }
    const body: Record<string, unknown> = {
        mode: video.mode,
        prompt: video.prompt,
        aspect_ratio: video.aspectRatio,
        duration: video.duration,
        generate_audio: video.generateAudio,
    };
    if (video.draft) body.draft = true;
    else body.resolution = video.resolution;

    if (video.mode === 'i2v') {
        const frames = media.keyframes ?? [];
        const mitZeit = frames.length > 0 && frames.every(frame => frame.time !== undefined);
        body.keyframes = mitZeit
            ? frames.map(frame => [frame.time, frame.base64])
            : frames.map(frame => frame.base64);
    }
    if (video.mode === 'v2v') body.start_video = media.startVideo;
    return body;
};

/** Größte Kante eines Keyframes. Das Video selbst ist in hd 1280 breit; mehr bringt nichts als Gewicht. */
const MAX_KEYFRAME_EDGE = 2048;

const alsKeyframe = async (bytes: Buffer): Promise<string> =>
    (
        await sharp(bytes)
            .rotate()
            .resize(MAX_KEYFRAME_EDGE, MAX_KEYFRAME_EDGE, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 92 })
            .toBuffer()
    ).toString('base64');

/**
 * Nimmt die Keyframes an: ein Name aus dem Bestand bleibt ein Verweis, ein
 * hochgeladenes Bild wird klein unter `videos/keyframes/` abgelegt, damit die
 * Liste später zeigen kann, woraus das Video entstand.
 */
export const acceptKeyframes = async (inputs: readonly KeyframeInput[]): Promise<VideoKeyframe[]> => {
    const ergebnis: VideoKeyframe[] = [];
    for (const [index, input] of inputs.entries()) {
        if (/^[A-Za-z0-9._-]+\.(png|jpe?g|webp)$/i.test(input.image) && fs.existsSync(imagePath(input.image))) {
            ergebnis.push({ image: input.image, source: 'library', time: input.time });
            continue;
        }
        const bild = parseInputImage(input.image, index);
        const name = `${uuidv4()}.jpg`;
        fs.mkdirSync(`${videoDir()}/${KEYFRAME_DIR}`, { recursive: true });
        await sharp(bild.buffer)
            .rotate()
            .resize(MAX_KEYFRAME_EDGE, MAX_KEYFRAME_EDGE, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 92 })
            .toFile(keyframePath(name));
        ergebnis.push({ image: name, source: 'upload', time: input.time });
    }
    return ergebnis;
};

const ladeMedien = async (video: DataVideo): Promise<VideoMedia> => {
    if (video.mode === 'i2v') {
        const keyframes = [];
        for (const frame of video.keyframes ?? []) {
            const pfad = frame.source === 'library' ? imagePath(frame.image) : keyframePath(frame.image);
            if (!fs.existsSync(pfad)) {
                throw new ProviderError(404, 'keyframe_missing', `Das Bild „${frame.image}" gibt es nicht mehr.`);
            }
            keyframes.push({ base64: await alsKeyframe(fs.readFileSync(pfad)), time: frame.time });
        }
        return { keyframes };
    }
    if (video.mode === 'v2v') {
        const quelle = video.startVideo ? findVideo(video.startVideo) : undefined;
        if (!quelle?.fileName || !fs.existsSync(videoPath(quelle.fileName))) {
            throw new ProviderError(404, 'start_video_missing', 'Das Video, das fortgesetzt werden soll, gibt es nicht mehr.');
        }
        return { startVideo: fs.readFileSync(videoPath(quelle.fileName)).toString('base64') };
    }
    if (video.mode === 'draft_enhance') {
        const entwurf = video.enhancedFrom ? findVideo(video.enhancedFrom) : undefined;
        if (!entwurf?.draftCache || !fs.existsSync(videoPath(entwurf.draftCache))) {
            throw new ProviderError(404, 'draft_cache_missing', 'Zu diesem Entwurf fehlt das Bündel zum Fertigrendern.');
        }
        return { draftCache: fs.readFileSync(videoPath(entwurf.draftCache)).toString('base64') };
    }
    return {};
};

/**
 * Wie lange höchstens gepollt wird. BFL nennt 61 s für einen Entwurf und
 * 108 s für einen vollen Lauf; bei Andrang (Lastabwurf, Warteschlange) und in
 * uhd wird es mehr. Zehn Minuten sind großzügig, kosten aber nichts.
 */
const VIDEO_POLL_DEADLINE_MS = 10 * 60 * 1000;

/**
 * Laufzeit einer MP4 aus dem `mvhd`-Atom. BFL meldet sie nicht, und ffprobe
 * gibt es im Container nicht — für eine Zahl genügen ein paar Bytes.
 */
export const mp4Seconds = (bytes: Buffer): number | undefined => {
    const i = bytes.indexOf('mvhd');
    if (i < 0 || i + 36 > bytes.length) return undefined;
    const version = bytes[i + 4];
    const timescale = version === 1 ? bytes.readUInt32BE(i + 24) : bytes.readUInt32BE(i + 16);
    const dauer = version === 1 ? Number(bytes.readBigUInt64BE(i + 28)) : bytes.readUInt32BE(i + 20);
    if (!timescale) return undefined;
    return Math.round((dauer / timescale) * 100) / 100;
};

/**
 * Zieht das Standbild bei 0,1 s aus dem Video. Ohne ffmpeg (lokal fehlt es
 * vielleicht) gibt es eben keins — die Oberfläche fällt dann auf das Video
 * selbst zurück. Gibt zurück, ob das Bild jetzt da ist.
 */
export const ensurePoster = (video: DataVideo): Promise<boolean> =>
    new Promise(resolve => {
        if (!video.fileName) return resolve(false);
        const ziel = posterPath(video.id);
        if (fs.existsSync(ziel)) return resolve(true);
        execFile(
            'ffmpeg',
            ['-loglevel', 'error', '-y', '-ss', '0.1', '-i', videoPath(video.fileName), '-frames:v', '1', '-vf', 'scale=720:-2', '-q:v', '4', ziel],
            { timeout: 20_000 },
            error => {
                if (error) console.warn(`Standbild für Video ${video.id} nicht erzeugt:`, error.message);
                resolve(!error && fs.existsSync(ziel));
            }
        );
    });

const herunterladen = async (url: string): Promise<Buffer> => {
    const response = await axios.get<ArrayBuffer>(url, { responseType: 'arraybuffer', timeout: 120_000 });
    return Buffer.from(response.data);
};

/** Welcher Preis gilt — beim Fertigrendern der Modus des Entwurfs. */
const preisModus = (video: DataVideo): 't2v' | 'i2v' | 'v2v' => {
    if (video.mode !== 'draft_enhance') return video.mode;
    const entwurf = video.enhancedFrom ? findVideo(video.enhancedFrom) : undefined;
    return entwurf && entwurf.mode !== 'draft_enhance' ? entwurf.mode : 't2v';
};

/** Pollt einen abgesendeten Auftrag zu Ende und legt das Ergebnis ab. */
const abschliessen = async (video: DataVideo, pollingUrl: string): Promise<void> => {
    const begonnen = video.startedAt;
    const ergebnis = await pollUntilReady(pollingUrl, VIDEO_POLL_DEADLINE_MS);
    fs.mkdirSync(videoDir(), { recursive: true });

    const fileName = `${video.createdAt}_${video.id}.mp4`;
    const bytes = await herunterladen(ergebnis.sample);
    fs.writeFileSync(videoPath(fileName), bytes);

    let draftCache: string | undefined;
    if (typeof ergebnis.draft_cache === 'string') {
        // Die URL verfällt; nur das Bündel selbst taugt später zum Fertigrendern.
        draftCache = `${video.id}.draft.bin`;
        fs.writeFileSync(videoPath(draftCache), await herunterladen(ergebnis.draft_cache));
    }

    const seconds = mp4Seconds(bytes);
    await ensurePoster({ ...video, fileName });
    // Gemeldet wird `cost` beim Abholen; fehlt es, aus der Preisliste schätzen.
    const gemeldet = typeof ergebnis.cost === 'number' ? ergebnis.cost : video.cost;
    const geschaetzt = gemeldet === undefined;
    updateVideo(video.id, {
        status: 'done',
        fileName,
        draftCache,
        // Am 07.10.2026 kam der Prompt trotz `Reasoning` unverändert zurück.
        revisedPrompt:
            typeof ergebnis.prompt === 'string' && ergebnis.prompt !== video.prompt ? ergebnis.prompt : undefined,
        seconds,
        durationMs: Date.now() - begonnen,
        pollingUrl: undefined,
        ...(!geschaetzt ? { cost: gemeldet, costUnit: 'credits' as const, costEstimated: false } : {}),
        ...(geschaetzt
            ? {
                  // BFL meldet bei Videos keine Kosten; 1 Credit = 0,01 $.
                  cost: Math.round(
                      estimateUsd(
                          preisModus(video),
                          video.resolution,
                          video.draft,
                          seconds ?? expectedSeconds(video.duration, video.keyframes)
                      ) * 100
                  ),
                  costUnit: 'credits' as const,
                  costEstimated: true,
              }
            : {}),
    });
};

const scheitern = (id: string, error: unknown): void => {
    const code = error instanceof ProviderError ? error.code : 'video_failed';
    const meldung = describeError(error);
    console.error(`Video ${id} fehlgeschlagen:`, meldung);
    updateVideo(id, { status: 'error', error: meldung, errorCode: code, pollingUrl: undefined });
};

/** Medien laden, absenden, die Polling-URL sofort sichern, dann abschließen. */
const ausfuehren = async (video: DataVideo): Promise<void> => {
    try {
        const body = buildVideoBody(video, await ladeMedien(video));
        const { pollingUrl, cost } = await submitTo(VIDEO_ENDPOINT, body);
        const aktuell = updateVideo(video.id, {
            pollingUrl,
            ...(cost !== undefined ? { cost, costUnit: 'credits' as const } : {}),
        });
        await abschliessen(aktuell ?? video, pollingUrl);
    } catch (error) {
        scheitern(video.id, error);
    }
};

export type VideoRequest = {
    mode: 't2v' | 'i2v' | 'v2v';
    prompt: string;
    aspectRatio: string;
    duration: number | 'auto';
    resolution: VideoResolution;
    draft: boolean;
    generateAudio: boolean;
    keyframes?: VideoKeyframe[];
    startVideo?: string;
};

const neuerEintrag = (felder: Omit<DataVideo, 'id' | 'createdAt' | 'status' | 'startedAt'>): DataVideo => ({
    id: uuidv4(),
    createdAt: currentTimestamp(),
    status: 'running',
    startedAt: Date.now(),
    ...felder,
});

/**
 * Legt den Eintrag an und startet den Lauf **im Hintergrund**. Die Antwort
 * wartet nicht: ein Video braucht Minuten, und weder Browser noch PWA halten
 * eine Verbindung so lange zuverlässig offen.
 */
export const startVideo = (request: VideoRequest): DataVideo => {
    const video = neuerEintrag({
        mode: request.mode,
        prompt: request.prompt,
        aspectRatio: request.aspectRatio,
        duration: request.duration,
        resolution: request.draft ? 'hd' : request.resolution,
        draft: request.draft,
        generateAudio: request.generateAudio,
        keyframes: request.keyframes,
        startVideo: request.startVideo,
    });
    addVideo(video);
    void ausfuehren(video);
    return video;
};

/** Einen Entwurf in voller Qualität rendern — dieselbe Aufnahme, nur größer und fertig. */
export const enhanceDraft = (draftId: string, resolution: VideoResolution): DataVideo => {
    const entwurf = findVideo(draftId);
    if (!entwurf) throw new ProviderError(404, 'not_found', 'Diesen Entwurf gibt es nicht.');
    if (!entwurf.draft || entwurf.status !== 'done' || !entwurf.draftCache) {
        throw new ProviderError(400, 'not_a_draft', 'Fertig rendern geht nur mit einem fertigen Entwurf.');
    }
    const video = neuerEintrag({
        mode: 'draft_enhance',
        prompt: entwurf.prompt,
        aspectRatio: entwurf.aspectRatio,
        duration: entwurf.duration,
        resolution,
        draft: false,
        generateAudio: entwurf.generateAudio,
        keyframes: entwurf.keyframes,
        enhancedFrom: entwurf.id,
    });
    addVideo(video);
    void ausfuehren(video);
    return video;
};

/**
 * Beim Start: was beim letzten Herunterfahren noch lief, weiterpollen. Ein
 * Eintrag ohne Polling-URL war noch nicht abgesendet — ob BFL ihn trotzdem
 * erhielt, ist nicht mehr feststellbar.
 */
export const resumeVideos = (): void => {
    for (const video of listVideos().filter(entry => entry.status === 'running')) {
        if (!video.pollingUrl) {
            scheitern(video.id, new ProviderError(500, 'video_interrupted', 'Der Dienst wurde neu gestartet, bevor der Auftrag abgesendet war.'));
            continue;
        }
        console.log(`Video ${video.id} lief beim Neustart noch — hole es nach.`);
        void abschliessen(video, video.pollingUrl).catch(error => scheitern(video.id, error));
    }
};
