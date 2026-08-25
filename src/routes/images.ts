import express from 'express';
import fs from 'fs';
import { z } from 'zod';
import appConfig from '../common/appConfig';
import { isImageFile } from '../common/fileUtils';
import { listImages } from '../common/imageQuery';
import { ensureThumbnails } from './thumbnails';
import { Sorting } from '../types';

/**
 * Der Bestand mit Metadaten, Suche, Filter und Cursor. Der Vorgänger
 * `/api/thumbnails/all` liefert nur Dateinamen — eine Suche über Prompts hätte
 * damit einen Einzelabruf je Bild gebraucht.
 */
const images: express.Router = express.Router();

const QuerySchema = z.object({
    q: z.string().max(200).optional(),
    model: z.string().max(60).optional(),
    provider: z.enum(['openai', 'bfl']).optional(),
    ratio: z.string().max(10).optional(),
    favorite: z.enum(['true', 'false']).optional(),
    sorting: z.nativeEnum(Sorting).optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
    cursor: z.string().max(200).optional(),
});

images.get('/', async (req, res) => {
    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) {
        return res.status(400).send({
            error: 'invalid_request',
            message: parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; '),
        });
    }
    const query = parsed.data;

    const fileNames = fs.readdirSync(appConfig.baseFolder).filter(isImageFile);
    const listing = listImages(
        {
            q: query.q,
            model: query.model,
            provider: query.provider,
            ratio: query.ratio,
            favorite: query.favorite === 'true',
            sorting: query.sorting ?? Sorting.DESCENDING,
            limit: query.limit,
            cursor: query.cursor,
        },
        fileNames
    );

    // Nur für die tatsächlich gelieferte Seite — nicht für den ganzen Bestand.
    await ensureThumbnails(listing.images.map(image => image.fileName));

    res.send(listing);
});

export default images;
