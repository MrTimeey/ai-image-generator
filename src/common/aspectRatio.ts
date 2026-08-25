import { AspectRatio, Quality } from '../types';
import { ModelDefinition } from '../controller/modelRegistry';

/**
 * Uebersetzt das eine Seitenverhaeltnis der Oberflaeche in das, was der
 * jeweilige Anbieter versteht. Das ist der Kern der Vereinheitlichung: die
 * Routen und das Frontend kennen nur noch `ratio` + `quality`.
 */
export type ResolvedSize = {
    width: number;
    height: number;
    /** Fuer `sizeMode: 'aspect_ratio'` — sonst leer. */
    aspectRatio?: AspectRatio;
    /** Fuer `sizeMode: 'pixel_size'` — der `size`-String fuer OpenAI. */
    size?: string;
};

/**
 * Zielpixelzahl je Stufe. Bei FLUX steuert die Stufe die Aufloesung (die API
 * kennt dort kein Qualitaetsfeld), bei OpenAI kommt sie **zusaetzlich** als
 * `quality` mit.
 */
const TARGET_PIXELS: Record<Quality, number> = {
    low: 1_000_000,
    medium: 2_000_000,
    high: 4_000_000,
    // `max` heisst „so gross, wie das Modell kann"; der echte Wert kommt aus
    // dessen `maxPixels`.
    max: Number.POSITIVE_INFINITY,
};

const ratioValue = (ratio: AspectRatio): number => {
    const [w, h] = ratio.split(':').map(Number);
    return w / h;
};

const roundTo = (value: number, multiple: number): number => Math.round(value / multiple) * multiple;

/**
 * Kanten aus Verhaeltnis und Zielflaeche, gerastert und in die Grenzen des
 * Modells gezwungen. Wird eine Kante geklemmt, zieht die andere nach — sonst
 * waere das Ergebnis wieder ein anderes Seitenverhaeltnis als bestellt.
 */
const edgesFor = (
    ratio: AspectRatio,
    pixels: number,
    edge: { multiple: number; min: number; max: number; maxPixels?: number }
): { width: number; height: number } => {
    const r = ratioValue(ratio);
    // Die Flaeche ist bei den meisten Anbietern die eigentliche Grenze — eine
    // einzelne Kante darf bei FLUX.2 durchaus ueber 2048 liegen.
    const zielFlaeche = Math.min(pixels, edge.maxPixels ?? pixels);
    let height = Math.sqrt(zielFlaeche / r);
    let width = height * r;

    if (width > edge.max) {
        width = edge.max;
        height = width / r;
    }
    if (height > edge.max) {
        height = edge.max;
        width = height * r;
    }
    if (width < edge.min) {
        width = edge.min;
        height = width / r;
    }
    if (height < edge.min) {
        height = edge.min;
        width = height * r;
    }

    const clamp = (v: number): number =>
        Math.min(edge.max, Math.max(edge.min, roundTo(v, edge.multiple)));

    let breite = clamp(width);
    let hoehe = clamp(height);

    /**
     * Nach dem Runden kann die Flaeche knapp ueber die Grenze rutschen — dann
     * lehnt der Anbieter den ganzen Auftrag ab. Also notfalls je ein Raster
     * kleiner, bis es passt.
     */
    if (edge.maxPixels) {
        while (breite * hoehe > edge.maxPixels && breite > edge.min && hoehe > edge.min) {
            if (breite >= hoehe) breite -= edge.multiple;
            else hoehe -= edge.multiple;
        }
    }

    return { width: breite, height: hoehe };
};

/** Die feste OpenAI-Groesse, deren Verhaeltnis dem gewuenschten am naechsten kommt. */
const nearestFixedSize = (ratio: AspectRatio, sizes: readonly string[]): ResolvedSize => {
    const target = ratioValue(ratio);
    let best = sizes[0];
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const size of sizes) {
        const [w, h] = size.split('x').map(Number);
        const distance = Math.abs(Math.log(w / h) - Math.log(target));
        if (distance < bestDistance) {
            bestDistance = distance;
            best = size;
        }
    }
    const [width, height] = best.split('x').map(Number);
    return { width, height, size: best };
};

export const resolveSize = (model: ModelDefinition, ratio: AspectRatio, quality: Quality): ResolvedSize => {
    if (model.sizeMode === 'aspect_ratio') {
        // Die Kanten sind hier nur informativ (fuer die Anzeige und data.json);
        // massgeblich ist, was der Anbieter aus dem Verhaeltnis macht.
        const { width, height } = edgesFor(ratio, TARGET_PIXELS[quality], {
            multiple: 16,
            min: 256,
            max: 2752,
        });
        return { width, height, aspectRatio: ratio };
    }

    if (model.fixedSizes) {
        return nearestFixedSize(ratio, model.fixedSizes);
    }

    const edge = model.edge ?? { multiple: 16, min: 256, max: 2048 };
    const { width, height } = edgesFor(ratio, TARGET_PIXELS[quality], edge);

    if (model.sizeMode === 'pixel_size') {
        return { width, height, size: `${width}x${height}` };
    }
    return { width, height };
};

/** Die Stufe, die das Modell tatsaechlich kennt — sonst die naechstniedrigere. */
export const clampQuality = (model: ModelDefinition, quality: Quality | undefined): Quality => {
    const supported = model.qualities;
    if (supported.length === 0) return 'medium';
    if (quality && supported.includes(quality)) return quality;
    const order: Quality[] = ['high', 'medium', 'low'];
    const wanted = order.indexOf(quality ?? 'medium');
    for (let i = wanted; i < order.length; i++) {
        if (supported.includes(order[i])) return order[i];
    }
    return supported[supported.length - 1];
};
