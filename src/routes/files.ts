import express from 'express';
import fs from 'fs-extra';
import appConfig from '../common/appConfig';
import { findEntry, removeEntry } from '../common/dataStore';
import sharp from 'sharp';
import path from 'path';
import { fromFormated, READ_FORMAT } from '../common/timeUtils';
import { modelNameOf, referencePath, safeImageName } from '../common/fileUtils';

const files: express.Router = express.Router();

const imageDir = `${appConfig.baseFolder}`;
export const bigThumbnailDir = path.join(__dirname, '..', 'static', 'big-thumbnails');

export const createBigThumbnail = async (imageName: string): Promise<void> => {
    fs.ensureDirSync(bigThumbnailDir);
    const thumbnailPath = path.join(bigThumbnailDir, imageName);
    if (fs.existsSync(thumbnailPath)) return;
    try {
        await sharp(path.join(imageDir, imageName)).resize(512).toFile(thumbnailPath);
    } catch (error) {
        /**
         * **Nicht weiterwerfen.** Bei einer unlesbaren Datei wirft sharp, und
         * der Aufrufer ist eine async-Route ohne `catch`: Express 4 leitet die
         * abgelehnte Promise nicht weiter, es wird nie geantwortet — der
         * Aufruf hing bis ins Zeitlimit des Clients. Ohne Vorschaubild ist die
         * Detailansicht unschön, aber bedienbar.
         */
        console.error(`Grosses Vorschaubild fuer ${imageName} nicht erzeugbar:`, error);
    }
};

/**
 * Loest den Namen aus der URL auf eine Datei im Bilderordner auf — oder auf
 * gar nichts. Vorher wurde der Parameter ungeprueft in den Pfad interpoliert.
 */
const resolveImage = (raw: string): { name: string; path: string } | null => {
    const name = safeImageName(raw);
    if (!name) return null;
    const filePath = path.join(imageDir, name);
    if (!fs.existsSync(filePath)) return null;
    return { name, path: filePath };
};

/**
 * Referenzbilder liegen in einem eigenen Ordner und werden nur hier
 * ausgeliefert — sie gehoeren nicht in die Uebersicht.
 */
files.get('/reference/:imageName', (req, res) => {
    const name = safeImageName(req.params.imageName);
    if (!name) {
        return res.status(404).send({ error: 'not_found', message: 'Referenzbild nicht gefunden.' });
    }
    const filePath = referencePath(name);
    if (!fs.existsSync(filePath)) {
        return res.status(404).send({ error: 'not_found', message: 'Referenzbild nicht gefunden.' });
    }
    res.sendFile(path.resolve(filePath));
});

files.get('/download/:imageName', async (req, res) => {
    const image = resolveImage(req.params.imageName);
    if (!image) {
        return res.status(404).send({ error: 'not_found', message: 'Bild nicht gefunden.' });
    }
    res.download(image.path);
});

files.get('/get/:imageName', async (req, res) => {
    const image = resolveImage(req.params.imageName);
    if (!image) {
        return res.status(404).send({ error: 'not_found', message: 'Bild nicht gefunden.' });
    }
    await createBigThumbnail(image.name);
    const entry = findEntry(image.name);
    const formattedDate = fromFormated(entry?.createdAt ?? '')?.format(READ_FORMAT) ?? '';
    res.send({
        prompt: entry?.description,
        revisedPrompt: entry?.revisedPrompt || 'unknown',
        filename: entry?.fileName ?? image.name,
        createdAt: formattedDate,
        model: modelNameOf(entry),
        provider: entry?.provider ?? '',
        ratio: entry?.ratio ?? '',
        width: entry?.width,
        height: entry?.height,
        referenceImages: entry?.referenceImages ?? [],
        seed: entry?.seed,
        quality: entry?.quality,
        outputFormat: entry?.outputFormat,
        cost: entry?.cost !== undefined ? { amount: entry.cost, unit: entry.costUnit ?? '' } : null,
        durationMs: entry?.durationMs,
        // Der alte Feldname, damit bestehende Skripte weiterlesen koennen.
        languageModel: modelNameOf(entry),
    });
});

files.delete('/:imageName', async (req, res) => {
    const image = resolveImage(req.params.imageName);
    if (!image) {
        // Schon weg ist auch weg — aber mit JSON antworten, damit Clients die
        // Antwort einheitlich lesen koennen.
        return res.status(200).send({ deleted: false });
    }
    fs.rmSync(image.path);
    // Gezielt diesen einen Eintrag — nicht den ganzen Ordner aufräumen.
    removeEntry(image.name);
    res.status(200).send({ deleted: true });
});

export default files;
