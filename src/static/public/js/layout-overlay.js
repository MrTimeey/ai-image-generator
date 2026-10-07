/**
 * Bounding Boxes von FLUX 3 über ein Bild legen. Gemeinsam für die
 * Komposition und die Detailansicht, damit beide dieselben Farben sprechen.
 *
 * Eine Box ist `[top, left, bottom, right]` auf dem 0–1000-Raster; als
 * Prozentwerte gesetzt passt sie zu jeder Anzeigegröße des Bildes.
 */

/**
 * Welche Rolle eine Zeile spielt. Erzeugen-Zeilen (`bbox`) sind `gen`,
 * Bearbeiten-Zeilen richten sich nach `from`, `src_bbox` und `tgt_bbox` —
 * dieselbe Tabelle wie in `src/common/layout.ts`.
 */
// eslint-disable-next-line no-unused-vars
function layoutRolle(row) {
    if (row.bbox) return 'gen';
    if (row.from === null || row.from === undefined) return 'new';
    if (row.tgt_bbox === null || row.tgt_bbox === undefined) return 'remove';
    const gleich = Array.isArray(row.src_bbox) && row.src_bbox.every((wert, i) => wert === row.tgt_bbox[i]);
    return gleich ? 'keep' : 'move';
}

// eslint-disable-next-line no-unused-vars
const LAYOUT_ROLLEN = {
    gen: { label: 'Element', farbe: '#8b5cf6' },
    keep: { label: 'behalten', farbe: '#8b5cf6' },
    move: { label: 'verschieben', farbe: '#f59e0b' },
    new: { label: 'neu / ersetzen', farbe: '#10b981' },
    remove: { label: 'entfernen', farbe: '#ef4444' },
};

/** Prozent-Stil einer Box auf dem 0–1000-Raster. */
// eslint-disable-next-line no-unused-vars
function boxStil(el, box) {
    const [top, left, bottom, right] = box;
    el.style.top = `${top / 10}%`;
    el.style.left = `${left / 10}%`;
    el.style.height = `${(bottom - top) / 10}%`;
    el.style.width = `${(right - left) / 10}%`;
}

/**
 * Zeichnet die Zeilen in `huelle` (ein `position: relative`-Element, das genau
 * das Bild umschließt). Vorhandene Boxen werden ersetzt.
 */
// eslint-disable-next-line no-unused-vars
function zeichneLayout(huelle, rows) {
    huelle.querySelectorAll('.lo-box').forEach((el) => el.remove());
    for (const row of rows ?? []) {
        const rolle = layoutRolle(row);
        const farbe = LAYOUT_ROLLEN[rolle].farbe;
        const ziel = row.bbox ?? row.tgt_bbox;
        // Bei „verschieben" und „entfernen" zählt auch, wo das Element herkam.
        if ((rolle === 'move' || rolle === 'remove') && row.src_bbox) {
            const quelle = document.createElement('div');
            quelle.className = 'lo-box lo-quelle';
            quelle.style.borderColor = farbe;
            boxStil(quelle, row.src_bbox);
            huelle.appendChild(quelle);
        }
        if (!ziel) continue;
        const box = document.createElement('div');
        box.className = 'lo-box';
        box.style.borderColor = farbe;
        box.style.backgroundColor = `${farbe}1a`;
        boxStil(box, ziel);
        const label = document.createElement('span');
        label.className = 'lo-label';
        label.style.backgroundColor = farbe;
        label.textContent = `${row.id} [${ziel.join(', ')}]`;
        box.appendChild(label);
        huelle.appendChild(box);
    }
}
