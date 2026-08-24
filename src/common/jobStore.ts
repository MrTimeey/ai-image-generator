import { GenerationResult } from '../types';

/**
 * Merkt sich laufende und beendete Generierungen, damit ein Client das
 * Ergebnis auch dann noch abholen kann, wenn seine Verbindung unterwegs
 * gestorben ist.
 *
 * Genau das passiert in der installierten PWA: wird sie in den Hintergrund
 * gelegt, friert das System die JS-Ausfuehrung ein und bricht den laufenden
 * `fetch` ab. Der Server generiert und speichert unbeirrt weiter — nur die
 * Antwort kommt nirgends mehr an, und die Oberflaeche meldete „Failed to
 * fetch", obwohl das Bild fertig auf der Platte lag.
 *
 * Bewusst im Speicher: ein Neustart des Containers verliert die Auftraege,
 * aber die Bilder sind da und stehen in der Uebersicht. Eine Datei dafuer
 * waere Ballast.
 */
export type JobState =
    | { status: 'running'; startedAt: number }
    | { status: 'done'; startedAt: number; finishedAt: number; result: GenerationResult }
    | { status: 'error'; startedAt: number; finishedAt: number; error: string; code: string };

/** Nach dieser Zeit ist ein Auftrag vergessen. */
const TTL_MS = 30 * 60 * 1000;
/** Reissleine gegen unbegrenztes Wachstum. */
const MAX_JOBS = 200;

const jobs = new Map<string, JobState>();

const prune = (): void => {
    const cutoff = Date.now() - TTL_MS;
    for (const [id, job] of jobs) {
        const stamp = job.status === 'running' ? job.startedAt : job.finishedAt;
        if (stamp < cutoff) jobs.delete(id);
    }
    // Falls trotzdem zu viele: die aeltesten zuerst. `Map` behaelt die
    // Einfuegereihenfolge, das genuegt hier.
    while (jobs.size > MAX_JOBS) {
        const oldest = jobs.keys().next();
        if (oldest.done) break;
        jobs.delete(oldest.value);
    }
};

/** Nur was der Client selbst erzeugt hat — kein Ratebereich fuer Fremde. */
export const isValidJobId = (id: unknown): id is string =>
    typeof id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(id);

export const startJob = (id: string): void => {
    prune();
    jobs.set(id, { status: 'running', startedAt: Date.now() });
};

export const finishJob = (id: string, result: GenerationResult): void => {
    const existing = jobs.get(id);
    jobs.set(id, {
        status: 'done',
        startedAt: existing?.startedAt ?? Date.now(),
        finishedAt: Date.now(),
        result,
    });
};

export const failJob = (id: string, code: string, error: string): void => {
    const existing = jobs.get(id);
    jobs.set(id, {
        status: 'error',
        startedAt: existing?.startedAt ?? Date.now(),
        finishedAt: Date.now(),
        code,
        error,
    });
};

export const getJob = (id: string): JobState | undefined => jobs.get(id);
