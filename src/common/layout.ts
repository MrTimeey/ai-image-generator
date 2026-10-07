import { z } from 'zod';

/**
 * Bounding Boxes fuer FLUX 3. Die API kennt dafuer **keinen eigenen
 * Parameter**: die Boxen stehen als JSON-Array am Ende von `prompt`, hinter
 * einer Beschreibung der ganzen Szene, die jedes Element als `<id>` nennt.
 * Hier wird beides getrennt angenommen, geprueft und erst beim Absenden
 * zusammengesetzt — so bleiben Szene und Elemente in `data.json` lesbar und
 * lassen sich spaeter wieder bearbeiten.
 *
 * Jede Box ist `[top, left, bottom, right]` in ganzen Zahlen von 0 bis 1000,
 * gemessen von oben links — unabhaengig von Groesse und Seitenverhaeltnis.
 * Boxen steuern Lage und Groesse, sie sind keine harte Maske.
 */

const Koordinate = z.number().int('Box-Werte sind ganze Zahlen').min(0).max(1000);

export const BoxSchema = z
    .tuple([Koordinate, Koordinate, Koordinate, Koordinate])
    .refine(([top, left, bottom, right]) => top < bottom && left < right, {
        message: 'Box muss [top, left, bottom, right] mit top < bottom und left < right sein',
    });

export type Box = [number, number, number, number];

const IdSchema = z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/, 'id nur aus Kleinbuchstaben, Ziffern und _, z. B. dome_1')
    .max(40);

const DescSchema = z.string().trim().min(1, 'desc darf nicht leer sein').max(2000);

/** Eine Zeile fuer ein neues Bild: wo das Element sitzt und wie es aussieht. */
export const GenerateRowSchema = z
    .object({ id: IdSchema, bbox: BoxSchema, desc: DescSchema })
    .strict();

/**
 * Eine Zeile fuer eine Bearbeitung. Woher das Element kommt und wohin es soll:
 *
 * | Zeile       | from          | src_bbox | tgt_bbox    |
 * | behalten    | `ref_image_0` | Box      | dieselbe    |
 * | verschieben | `ref_image_0` | Box      | neue Box    |
 * | neu/ersetzen| `null`        | `null`   | Box         |
 * | entfernen   | `ref_image_0` | Box      | `null`      |
 */
export const EditRowSchema = z
    .object({
        id: IdSchema,
        from: z
            .string()
            .regex(/^ref_image_\d$/, 'from ist ref_image_0 … ref_image_9 oder null')
            .nullable(),
        src_bbox: BoxSchema.nullable(),
        tgt_bbox: BoxSchema.nullable(),
        desc: DescSchema,
    })
    .strict();

export type GenerateRow = z.infer<typeof GenerateRowSchema>;
export type EditRow = z.infer<typeof EditRowSchema>;
export type LayoutRow = GenerateRow | EditRow;

export const MAX_LAYOUT_ROWS = 50;

/**
 * Liest ein Layout aus dem Request. Entweder nur Erzeugen-Zeilen oder nur
 * Bearbeiten-Zeilen — welche Sorte, entscheidet die erste Zeile. Ein
 * `z.union` haette dasselbe gekonnt, meldet aber nur „Invalid input" statt
 * des Feldes, das nicht stimmt.
 */
export const parseLayout = (value: unknown): { rows?: LayoutRow[]; errors: string[] } => {
    if (!Array.isArray(value) || value.length === 0) {
        return { errors: ['layout: eine nicht leere Liste von Elementen erwartet'] };
    }
    if (value.length > MAX_LAYOUT_ROWS) {
        return { errors: [`layout: höchstens ${MAX_LAYOUT_ROWS} Elemente`] };
    }
    const erste = value[0];
    const bearbeiten =
        typeof erste === 'object' && erste !== null && ('tgt_bbox' in erste || 'src_bbox' in erste || 'from' in erste);
    const parsed = z.array(bearbeiten ? EditRowSchema : GenerateRowSchema).safeParse(value);
    if (!parsed.success) {
        return { errors: parsed.error.errors.map(e => `layout.${e.path.join('.')}: ${e.message}`) };
    }
    return { rows: parsed.data, errors: [] };
};

export const isEditLayout = (rows: readonly LayoutRow[]): rows is EditRow[] =>
    rows.length > 0 && 'tgt_bbox' in rows[0];

export type EditRole = 'keep' | 'move' | 'new' | 'remove';

export const editRole = (row: EditRow): EditRole => {
    if (row.from === null) return 'new';
    if (row.tgt_bbox === null) return 'remove';
    const gleich = row.src_bbox !== null && row.src_bbox.every((wert, i) => wert === row.tgt_bbox?.[i]);
    return gleich ? 'keep' : 'move';
};

/**
 * Was das Schema allein nicht pruefen kann: eindeutige ids, stimmige
 * Kombinationen und ob die genannten Referenzbilder ueberhaupt mitkommen.
 * Gibt die Fehler als Saetze zurueck; leer heisst gueltig.
 */
export const layoutErrors = (rows: readonly LayoutRow[], referenceCount: number): string[] => {
    const fehler: string[] = [];
    const gesehen = new Set<string>();
    for (const row of rows) {
        if (gesehen.has(row.id)) fehler.push(`id „${row.id}" kommt doppelt vor.`);
        gesehen.add(row.id);
    }
    if (!isEditLayout(rows)) return fehler;

    if (referenceCount === 0) {
        fehler.push('Ein Bearbeiten-Layout braucht das Ausgangsbild als Referenz.');
    }
    for (const row of rows) {
        if (row.from === null) {
            if (row.src_bbox !== null) fehler.push(`„${row.id}": ohne from gibt es keine src_bbox.`);
            if (row.tgt_bbox === null) fehler.push(`„${row.id}": ein neues Element braucht eine tgt_bbox.`);
            continue;
        }
        if (row.src_bbox === null) fehler.push(`„${row.id}": mit from braucht es die src_bbox im Ausgangsbild.`);
        const index = Number(row.from.slice('ref_image_'.length));
        if (referenceCount > 0 && index >= referenceCount) {
            fehler.push(`„${row.id}": ${row.from} gibt es nicht, mitgegeben wurden ${referenceCount} Bild(er).`);
        }
    }
    return fehler;
};

const ERWAEHNUNG = /<([a-z][a-z0-9_]*)>/g;

/**
 * Hinweise, keine Fehler: der Prompt geht trotzdem hinaus. Ein Element, das
 * die Szene nicht nennt, setzt FLUX 3 oft nur halbherzig um; ein `<id>` ohne
 * Zeile ist meist ein Tippfehler.
 */
export const layoutWarnings = (scene: string, rows: readonly LayoutRow[]): string[] => {
    const genannt = new Set(Array.from(scene.matchAll(ERWAEHNUNG), treffer => treffer[1]));
    const ids = new Set(rows.map(row => row.id));
    const hinweise: string[] = [];
    for (const row of rows) {
        if (!genannt.has(row.id)) hinweise.push(`„${row.id}" wird im Szenen-Prompt nicht als <${row.id}> genannt.`);
    }
    for (const name of genannt) {
        if (!ids.has(name) && !/^ref_image_\d$/.test(name)) {
            hinweise.push(`<${name}> steht im Szenen-Prompt, aber es gibt keine Zeile dazu.`);
        }
    }
    return hinweise;
};

/** Feste Feldreihenfolge, wie in BFLs Beispielen — und ohne Felder, die nicht hineingehoeren. */
const normalisiert = (row: LayoutRow): LayoutRow =>
    'tgt_bbox' in row
        ? { id: row.id, from: row.from, src_bbox: row.src_bbox, tgt_bbox: row.tgt_bbox, desc: row.desc }
        : { id: row.id, bbox: row.bbox, desc: row.desc };

/** Szene, ein Leerzeichen, das JSON-Array — genau so erwartet es FLUX 3. */
export const composePrompt = (scene: string, rows: readonly LayoutRow[] | undefined): string =>
    rows && rows.length > 0 ? `${scene.trim()} ${JSON.stringify(rows.map(normalisiert))}` : scene;
