#!/usr/bin/env node
/**
 * Prueft die **Inline-Skripte** der HTML-Seiten auf undeklarierte Variablen.
 *
 * `npm run lint` sieht nur die TypeScript-Dateien. Die Seitenlogik steht aber
 * in <script>-Bloecken, und dort wird eine vergessene Deklaration im
 * nicht-strengen Modus stillschweigend zur globalen Variablen — bis der erste
 * *Lese*-Zugriff sie als ReferenceError auffliegen laesst, oft erst in
 * Produktion. Genau das ist mit `references` passiert.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ESLint } from 'eslint';

const STATIC_DIR = 'src/static';
// Die extern eingebundenen Skripte gehoeren dazu, sonst gilt jede ihrer
// Funktionen als undefiniert.
const SHARED = ['src/static/js/main.js', 'src/static/public/js/toast.js', 'src/static/public/js/nav.js']
    .map(path => readFileSync(path, 'utf8'))
    .join('\n;\n');

const eslint = new ESLint({
    useEslintrc: false,
    overrideConfig: {
        parserOptions: { ecmaVersion: 2022, sourceType: 'script' },
        env: { browser: true, es2022: true },
        rules: { 'no-undef': 'error' },
    },
});

let failed = false;
for (const file of readdirSync(STATIC_DIR).filter(name => name.endsWith('.html'))) {
    const html = readFileSync(join(STATIC_DIR, file), 'utf8');
    const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
    if (blocks.length === 0) continue;

    const prelude = `${SHARED}\n;\n`;
    const source = `"use strict";\n${prelude}${blocks.join('\n;\n')}`;
    // Zeilen des Vorspanns abziehen, damit die Meldung auf die HTML-Datei zeigt.
    const preludeLines = prelude.split('\n').length + 1;

    const [result] = await eslint.lintText(source, { filePath: `${file}.js` });
    const real = result.messages.filter(message => message.ruleId === 'no-undef');
    for (const message of real) {
        failed = true;
        const line = message.line - preludeLines;
        console.error(`${STATIC_DIR}/${file}: Skriptzeile ~${line}: ${message.message}`);
    }
}

if (failed) {
    console.error('\nUndeklarierte Variablen in den Inline-Skripten gefunden.');
    process.exit(1);
}
console.log('Inline-Skripte: keine undeklarierten Variablen.');
