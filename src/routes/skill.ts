import express from 'express';
import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import appConfig from '../common/appConfig';

/**
 * Liefert den Claude-Skill als ZIP. Der Weg ueber ein Plugin
 * (`/plugin marketplace add …`) ist der bequemere, aber er setzt voraus, dass
 * das Repo erreichbar ist — der Download hier funktioniert auch ohne GitHub
 * und macht sichtbar, was man sich eigentlich installiert.
 */
const skill: express.Router = express.Router();

const SKILL_DIR = path.join(__dirname, '..', '..', 'plugin', 'skills', 'ai-image');
/** Die Adresse, die im ausgelieferten Skill als Standard stehen soll. */
const PLACEHOLDER_URL = 'https://ai.mrtimeey.com';

const skillFiles = (dir: string, base = ''): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const relative = base ? `${base}/${entry.name}` : entry.name;
        if (entry.isDirectory()) return skillFiles(path.join(dir, entry.name), relative);
        return [relative];
    });

/**
 * Die Standardadresse im Skill auf die dieser Instanz umschreiben. Wer den
 * Generator unter einem anderen Namen betreibt, bekaeme sonst ein CLI, das
 * stur auf ai.mrtimeey.com zeigt.
 */
const contentFor = (fullPath: string): Buffer => {
    const raw = fs.readFileSync(fullPath);
    if (appConfig.publicBaseUrl === PLACEHOLDER_URL) return raw;
    if (!/\.(md|py)$/.test(fullPath)) return raw;
    return Buffer.from(raw.toString('utf8').split(PLACEHOLDER_URL).join(appConfig.publicBaseUrl), 'utf8');
};

skill.get('/download', (_req, res) => {
    if (!fs.existsSync(SKILL_DIR)) {
        return res.status(500).send({ error: 'skill_missing', message: 'Der Skill liegt nicht im Image.' });
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="ai-image-skill.zip"');

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', error => {
        console.error('Skill-ZIP fehlgeschlagen:', error);
        res.destroy();
    });
    archive.pipe(res);

    for (const relative of skillFiles(SKILL_DIR)) {
        const fullPath = path.join(SKILL_DIR, relative);
        archive.append(contentFor(fullPath), {
            // Oberste Ebene `ai-image/`, damit ein Entpacken nach
            // ~/.claude/skills/ direkt das richtige Verzeichnis ergibt.
            name: `ai-image/${relative}`,
            mode: relative.endsWith('.py') ? 0o755 : 0o644,
        });
    }
    archive.finalize();
});

export default skill;
