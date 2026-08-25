// Als .mjs, weil das Projekt CommonJS ist: eine .ts-Konfiguration mit
// ESM-Syntax laedt Vite sonst mit einer Warnung als CommonJS.
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // Nur die reine Logik: die Module ohne Dateizugriff und ohne Netz.
        include: ['src/**/*.test.ts'],
        environment: 'node',
    },
});
