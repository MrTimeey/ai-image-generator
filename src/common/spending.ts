import { getDataStore } from './dataStore';

/**
 * Was hier tatsächlich ausgegeben wurde — gerechnet aus dem, was die Anbieter
 * je Auftrag gemeldet haben.
 *
 * Das ergänzt `creditsController`, das nur zeigt, was die Anbieter über ihre
 * eigenen Endpunkte hergeben: bei BFL das Restguthaben, bei OpenAI gar nichts.
 * Hier steht dagegen, wofür das Geld ging — je Modell und Monat.
 *
 * **Zwei Einheiten, keine Umrechnung.** BFL rechnet in eigenen Credits,
 * OpenAI in Dollar; einen Kurs dazwischen zu erfinden wäre eine Zahl, der man
 * nicht trauen kann.
 */
export type SpendingBucket = {
    /** `YYYY-MM`, oder die Modell-ID — je nach Auswertung. */
    key: string;
    credits: number;
    usd: number;
    /** Bilder mit Kostenangabe. */
    images: number;
    /** Bilder ohne — alles von vor dieser Änderung. */
    unknown: number;
};

const leer = (key: string): SpendingBucket => ({ key, credits: 0, usd: 0, images: 0, unknown: 0 });

const addTo = (bucket: SpendingBucket, cost: number | undefined, unit: string | undefined): void => {
    if (cost === undefined || cost === null) {
        bucket.unknown += 1;
        return;
    }
    bucket.images += 1;
    if (unit === 'credits') bucket.credits += cost;
    else if (unit === 'usd') bucket.usd += cost;
};

const round = (bucket: SpendingBucket): SpendingBucket => ({
    ...bucket,
    credits: Math.round(bucket.credits * 100) / 100,
    usd: Math.round(bucket.usd * 10_000) / 10_000,
});

export type SpendingReport = {
    total: SpendingBucket;
    byMonth: SpendingBucket[];
    byModel: SpendingBucket[];
};

export const spendingReport = (monate = 6): SpendingReport => {
    const total = leer('gesamt');
    const monatlich = new Map<string, SpendingBucket>();
    const proModell = new Map<string, SpendingBucket>();

    for (const entry of getDataStore().data) {
        // `createdAt` hat die Form `YYYY-MM-DD_HH-mm`; die ersten sieben
        // Zeichen sind der Monat, ohne dass dafür geparst werden muss.
        const monat = (entry.createdAt ?? '').slice(0, 7) || 'unbekannt';
        const modell = entry.model ?? entry.languageModel ?? 'unbekannt';

        for (const bucket of [
            total,
            monatlich.get(monat) ?? monatlich.set(monat, leer(monat)).get(monat) as SpendingBucket,
            proModell.get(modell) ?? proModell.set(modell, leer(modell)).get(modell) as SpendingBucket,
        ]) {
            addTo(bucket, entry.cost, entry.costUnit);
        }
    }

    return {
        total: round(total),
        byMonth: [...monatlich.values()]
            .sort((a, b) => b.key.localeCompare(a.key))
            .slice(0, monate)
            .map(round),
        // Nur Modelle, für die überhaupt etwas bekannt ist — sonst steht die
        // Liste voll mit Altdaten ohne Aussage.
        byModel: [...proModell.values()]
            .filter(bucket => bucket.images > 0)
            .sort((a, b) => b.credits + b.usd * 100 - (a.credits + a.usd * 100))
            .map(round),
    };
};
