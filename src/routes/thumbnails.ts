import express, { Request } from 'express';
import fs from 'fs-extra';
import appConfig from '../common/appConfig';
import sharp from 'sharp';
import path from 'path';
import { Sorting } from '../types';
import { isImageFile } from '../common/fileUtils';
import { listImages } from '../common/imageQuery';

const thumbnails: express.Router = express.Router();

export const thumbnailDir = `${__dirname}/../static/thumbnails`;
const imageDir = `${appConfig.baseFolder}`;

export async function createThumbnail(image: string) {
    const thumbnailPath = path.join(thumbnailDir, image);
    const imagePath = path.join(appConfig.baseFolder, image);
    if (!fs.existsSync(thumbnailPath) && fs.existsSync(imagePath)) {
        await sharp(imagePath).resize(200).toFile(thumbnailPath);
    }
}

/**
 * Erzeugt fehlende Vorschaubilder — aber nur die, die wirklich fehlen.
 *
 * Vorher lief eine Schleife über **alle** Bilder mit je zwei `existsSync`,
 * auch wenn seit Monaten keines fehlte: bei 800 Bildern rund 1600
 * Dateisystemzugriffe pro Aufruf der Übersicht. Ein Verzeichnis-Scan als `Set`
 * genügt.
 */
export const ensureThumbnails = async (fileNames: string[]): Promise<void> => {
    fs.ensureDirSync(thumbnailDir);
    const vorhanden = new Set(fs.readdirSync(thumbnailDir));
    for (const name of fileNames) {
        if (vorhanden.has(name)) continue;
        try {
            await createThumbnail(name);
        } catch (error) {
            /**
             * **Ein kaputtes Bild darf nicht die Übersicht kosten.** sharp wirft
             * bei unlesbaren Dateien (abgebrochener Download, halb geschriebene
             * Datei), und weil das hier in einer async-Route lief, wurde daraus
             * eine unbehandelte Rejection — der Prozess war weg, wegen *eines*
             * Bildes unter achthundert.
             */
            console.error(`Vorschaubild fuer ${name} nicht erzeugbar:`, error);
        }
    }
};

const getSorting = (req: Request): Sorting =>
    req.query?.sorting === Sorting.DESCENDING ? Sorting.DESCENDING : Sorting.ASCENDING;

/**
 * Der alte Endpunkt: liefert nur Dateinamen, ohne Paginierung. Bleibt für
 * ältere Skripte bestehen — neue Aufrufe gehören an `GET /api/images`, das
 * auch Metadaten, Suche und einen Cursor kennt.
 */
thumbnails.get('/all', async (req, res) => {
    const sorting = getSorting(req);
    const fileNames = fs.readdirSync(imageDir).filter(isImageFile);
    // **Ohne Begrenzung**, anders als `/api/images`: der alte Endpunkt hat
    // immer den ganzen Bestand geliefert, und Skripte verlassen sich darauf.
    const sorted = listImages({ sorting, limit: Math.max(fileNames.length, 1) }, fileNames).images.map(
        image => image.fileName
    );
    await ensureThumbnails(sorted);
    res.send(sorted);
});

export default thumbnails;
