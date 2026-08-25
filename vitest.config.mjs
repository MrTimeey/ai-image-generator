// Als .mjs, weil das Projekt CommonJS ist: eine .ts-Konfiguration mit
// ESM-Syntax laedt Vite sonst mit einer Warnung als CommonJS.
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // Nur die reine Logik: die Module ohne Dateizugriff und ohne Netz.
        include: ['src/**/*.test.ts'],
        environment: 'node',
        /**
         * `appConfig` prüft beim Laden, ob wenigstens ein Anbieter-Schlüssel
         * gesetzt ist, und wirft sonst — bewusst früh statt beim ersten
         * Aufruf. Module wie `fileUtils` ziehen es mit, also brauchen auch
         * reine Logiktests eine Minimalkonfiguration. Lokal kam sie
         * unbemerkt aus der `.env`; in der CI gibt es keine, und genau dort
         * fiel es auf.
         *
         * Platzhalter, keine echten Werte: Die Tests rufen keinen Anbieter.
         */
        env: {
            BFL_API_KEY: 'test-schluessel-ohne-funktion',
            AI_IMAGE_GENERATOR_OUTPUT_PATH: '/tmp/aig-test-nicht-verwendet',
            AUTH_ENABLED: 'false',
        },
    },
});
