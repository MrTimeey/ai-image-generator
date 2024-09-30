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

const exchange: express.Router = express.Router();

const imageDir = `${appConfig.baseFolder}`;

exchange.get('/all', async (req, res) => {
    const tempDir = os.tmpdir();
    const zipFilePath = path.join(tempDir, `export-${Date.now()}.zip`);

    const output = fs.createWriteStream(zipFilePath);
    const archive = archiver('zip', { zlib: { level: 9 } });


    archive.on('error', (err) => {
        throw err;
    });
    archive.directory(imageDir, false);
    archive.finalize();
    output.on('close', () => {
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', 'attachment; filename="export.zip"');

        res.download(zipFilePath, 'export.zip', (err) => {
            if (err) {
                res.status(500).send('Fehler beim Senden der Datei.');
            } else {
                fs.unlinkSync(zipFilePath); // Temporäre Datei nach dem Senden löschen
            }
        });
    });
    archive.pipe(output);
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

const upload = multer({ storage: storage });

exchange.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).send('Keine Datei hochgeladen.');
    }
    console.log(`Datei hochgeladen: ${req.file.filename}`);

    const uploadedFile = path.join(imageDir, 'uploads', req.file.filename)
    const zip = new AdmZip(uploadedFile)
    const unzippedFolderPath = uploadedFile.replace(path.extname(uploadedFile), '');
    zip.extractAllTo(unzippedFolderPath);

    const dataStore = getDataStore();
    const imageMap = getImageMap(dataStore);
    const importDataStore = getDataStoreFromPath(unzippedFolderPath);
    const importImageMap = getImageMap(importDataStore);

    if (importDataStore.entries === 0) {
        return res.status(400).send('Keine Daten vorhanden.');
    }
    for (const imageToImport of importDataStore.data) {
        const imageName = imageToImport?.fileName?? '';
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
            fs.renameSync(importImagePath, path.join(imageDir, imageName))
            dataStore.data.push(importImageMap[imageName]);
            dataStore.entries = dataStore.entries + 1
        }
    }
    saveDataStore(dataStore);
    rimraf.sync(unzippedFolderPath)
    rimraf.sync(uploadedFile)
    rimraf.sync(path.join(imageDir, 'uploads'))

    res.status(200).send({
        message: 'Dateien erfolgreich importiert.',
        fileName: req.file.filename
    });
})

export default exchange;
