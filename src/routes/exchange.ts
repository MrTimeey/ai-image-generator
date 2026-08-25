import path from 'path';
import fs from 'fs-extra';
import archiver from 'archiver';
import express from 'express';
import os from 'os';
import appConfig from '../common/appConfig';
import multer from 'multer';
import AdmZip from 'adm-zip';
import { getDataStore, getDataStoreFromPath, getImageMap, saveDataStore } from '../common/dataStore';
import { rimraf } from 'rimraf';
import { isImageFile, safeImageName } from '../common/fileUtils';

const exchange: express.Router = express.Router();

const imageDir = `${appConfig.baseFolder}`;

exchange.get('/all', async (req, res) => {
    const tempDir = os.tmpdir();
    const zipFilePath = path.join(tempDir, `export-${Date.now()}.zip`);

    const output = fs.createWriteStream(zipFilePath);
    const archive = archiver('zip', { zlib: { level: 9 } });


    // **Kein `throw` hier.** Ein Wurf in einem asynchronen EventEmitter-Callback
    // landet als `uncaughtException` und reisst den ganzen Server mit — ein
    // fehlgeschlagener Export hat den Dienst beendet.
    let fehlgeschlagen = false;
    archive.on('error', (err) => {
        fehlgeschlagen = true;
        console.error('Export fehlgeschlagen:', err);
        if (!res.headersSent) res.status(500).send({ error: 'export_failed', message: 'Der Export ist fehlgeschlagen.' });
        fs.rm(zipFilePath, { force: true }, () => undefined);
    });
    // Gezielt statt `archive.directory(imageDir, false)`: im Bilderordner
    // liegt seit den API-Keys auch `api-keys.json`, und die gehoert in kein
    // Export-Archiv.
    for (const entry of fs.readdirSync(imageDir)) {
        if (!isImageFile(entry) && entry !== 'data.json') continue;
        const entryPath = path.join(imageDir, entry);
        if (!fs.statSync(entryPath).isFile()) continue;
        archive.file(entryPath, { name: entry });
    }
    archive.finalize();
    output.on('close', () => {
        if (fehlgeschlagen) return;
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', 'attachment; filename="export.zip"');

        res.download(zipFilePath, 'export.zip', (err) => {
            if (err) {
                console.error('Export liess sich nicht senden:', err);
            }
            // **Immer** aufräumen, nicht nur im Erfolgsfall: bei 800 Bildern
            // bleibt sonst je Abbruch ein dreistelliger MB-Brocken in /tmp.
            fs.rm(zipFilePath, { force: true }, () => undefined);
        });
    });
    archive.pipe(output);
});

/**
 * Nur die ausgewählten Bilder als ZIP — im Unterschied zu `/all`, das den
 * ganzen Bestand samt `data.json` für einen Umzug packt. Hier geht es darum,
 * eine Handvoll Bilder mitzunehmen, also ohne Metadatendatei.
 */
exchange.post('/selection', async (req, res) => {
    const namen: unknown = req.body?.fileNames;
    if (!Array.isArray(namen) || namen.length === 0 || namen.length > 500) {
        return res.status(400).send({ error: 'invalid_request', message: 'Feld `fileNames` fehlt, ist leer oder zu lang.' });
    }

    const dateien = namen
        .map(name => (typeof name === 'string' ? safeImageName(name) : null))
        .filter((name): name is string => Boolean(name))
        .map(name => ({ name, pfad: path.join(imageDir, name) }))
        .filter(datei => fs.existsSync(datei.pfad));

    if (dateien.length === 0) {
        return res.status(404).send({ error: 'not_found', message: 'Keines der Bilder existiert.' });
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="auswahl-${dateien.length}.zip"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', error => {
        console.error('Auswahl-Export fehlgeschlagen:', error);
        res.destroy();
    });
    // Direkt in die Antwort statt über eine temporäre Datei: bei einer Auswahl
    // ist das Archiv klein genug, und es bleibt nichts liegen.
    archive.pipe(res);
    for (const datei of dateien) archive.file(datei.pfad, { name: datei.name });
    await archive.finalize();
});

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadPath = path.join(imageDir, 'uploads');
        fs.ensureDirSync(uploadPath);
        cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

// Ohne Grenze nimmt der Upload alles entgegen, was hereinkommt.
const upload = multer({ storage, limits: { fileSize: 2 * 1024 * 1024 * 1024, files: 1 } });

exchange.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).send('Keine Datei hochgeladen.');
    }
    console.debug(`Datei hochgeladen: ${req.file.filename}`);

    const uploadedFile = path.join(imageDir, 'uploads', req.file.filename)
    const zip = new AdmZip(uploadedFile)
    const unzippedFolderPath = uploadedFile.replace(path.extname(uploadedFile), '');
    fs.ensureDirSync(unzippedFolderPath);
    // Nicht `extractAllTo`: ein Archiv aus fremder Hand kann Eintraege wie
    // `../../etc/…` enthalten, und AdmZip legt die bereitwillig an.
    for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue;
        const name = entry.entryName;
        if (name !== 'data.json' && !safeImageName(name)) continue;
        fs.writeFileSync(path.join(unzippedFolderPath, path.basename(name)), entry.getData());
    }

    const dataStore = getDataStore();
    const imageMap = getImageMap(dataStore);
    const importDataStore = getDataStoreFromPath(unzippedFolderPath);
    const importImageMap = getImageMap(importDataStore);

    if (importDataStore.entries === 0) {
        return res.status(400).send('Keine Daten vorhanden.');
    }
    for (const imageToImport of importDataStore.data) {
        // Der Name stammt aus einer fremden `data.json` und darf den
        // Bilderordner nicht verlassen.
        const imageName = safeImageName(imageToImport?.fileName ?? '') ?? '';
        if (imageName === '') {
            continue
        }
        if (imageMap[imageName]) {
            if (imageToImport) {
                const importImagePath = path.join(unzippedFolderPath, imageName);
                if (fs.existsSync(importImagePath)) {
                    fs.rmSync(importImagePath)
                }
            }
        } else {
            const importImagePath = path.join(unzippedFolderPath, imageName);
            // Ein Eintrag ohne zugehoerige Datei hat den Import frueher mit
            // ENOENT abgebrochen — der Rest des Archivs blieb liegen.
            if (!fs.existsSync(importImagePath)) continue;
            fs.renameSync(importImagePath, path.join(imageDir, imageName))
            dataStore.data.push(importImageMap[imageName]);
        }
    }
    saveDataStore(dataStore);
    rimraf.sync(unzippedFolderPath)
    rimraf.sync(uploadedFile)
    // Nur die eigene Datei, nicht das ganze Verzeichnis: ein zweiter,
    // gleichzeitig laufender Upload verlor sonst seine.

    res.status(200).send({
        message: 'Dateien erfolgreich importiert.',
        fileName: req.file.filename
    });
})

export default exchange;
