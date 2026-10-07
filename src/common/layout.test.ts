import { describe, expect, it } from 'vitest';
import { composePrompt, editRole, EditRow, layoutErrors, layoutWarnings, parseLayout } from './layout';

const kuppel = { id: 'dome_1', bbox: [250, 150, 650, 850], desc: 'a massive parabolic dome of pale concrete' };
const menge = { id: 'crowd_1', bbox: [740, 0, 1000, 1000], desc: 'a large crowd seated on the beach' };

const behalten = (id: string, box: number[]): EditRow =>
    ({ id, from: 'ref_image_0', src_bbox: box, tgt_bbox: box, desc: 'x' }) as EditRow;

describe('parseLayout', () => {
    it('nimmt ein Erzeugen-Layout an', () => {
        const { rows, errors } = parseLayout([kuppel, menge]);
        expect(errors).toEqual([]);
        expect(rows).toHaveLength(2);
    });

    it('nimmt ein Bearbeiten-Layout an', () => {
        const { rows, errors } = parseLayout([behalten('log_1', [600, 0, 1000, 1000])]);
        expect(errors).toEqual([]);
        expect(rows?.[0]).toHaveProperty('tgt_bbox');
    });

    it('nennt das Feld, das nicht stimmt', () => {
        const { errors } = parseLayout([{ ...kuppel, bbox: [650, 150, 250, 850] }]);
        expect(errors[0]).toContain('layout.0.bbox');
        expect(errors[0]).toContain('top < bottom');
    });

    it('weist Werte außerhalb des 0–1000-Rasters ab', () => {
        expect(parseLayout([{ ...kuppel, bbox: [0, 0, 1001, 500] }]).errors).not.toEqual([]);
        expect(parseLayout([{ ...kuppel, bbox: [0, 0, 500.5, 500] }]).errors).not.toEqual([]);
    });

    it('weist ids ab, die FLUX 3 nicht als <id> lesen kann', () => {
        expect(parseLayout([{ ...kuppel, id: 'Dome 1' }]).errors[0]).toContain('layout.0.id');
    });

    it('weist fremde Felder ab — das Schema von BFL tut es auch', () => {
        expect(parseLayout([{ ...kuppel, farbe: 'rot' }]).errors).not.toEqual([]);
    });

    it('weist gemischte Layouts ab', () => {
        expect(parseLayout([behalten('log_1', [0, 0, 500, 500]), kuppel]).errors).not.toEqual([]);
    });

    it('weist ein leeres Layout ab', () => {
        expect(parseLayout([]).errors).not.toEqual([]);
    });
});

describe('layoutErrors', () => {
    it('findet doppelte ids', () => {
        expect(layoutErrors([kuppel, kuppel] as never, 0)[0]).toContain('doppelt');
    });

    it('verlangt beim Bearbeiten das Ausgangsbild', () => {
        expect(layoutErrors([behalten('log_1', [0, 0, 500, 500])], 0)).not.toEqual([]);
        expect(layoutErrors([behalten('log_1', [0, 0, 500, 500])], 1)).toEqual([]);
    });

    it('verlangt für ein neues Element eine Zielbox', () => {
        const neu = { id: 'bird_1', from: null, src_bbox: null, tgt_bbox: null, desc: 'x' } as EditRow;
        expect(layoutErrors([neu], 1)[0]).toContain('tgt_bbox');
    });

    it('verlangt die Quellbox, wenn das Element aus dem Bild kommt', () => {
        const ohneQuelle = { id: 'cat_1', from: 'ref_image_0', src_bbox: null, tgt_bbox: null, desc: 'x' } as EditRow;
        expect(layoutErrors([ohneQuelle], 1)[0]).toContain('src_bbox');
    });

    it('kennt nur so viele Referenzbilder, wie mitkommen', () => {
        const zweites = { ...behalten('log_1', [0, 0, 500, 500]), from: 'ref_image_1' };
        expect(layoutErrors([zweites], 1)[0]).toContain('ref_image_1');
        expect(layoutErrors([zweites], 2)).toEqual([]);
    });
});

describe('editRole', () => {
    it('unterscheidet die vier Zeilenarten', () => {
        expect(editRole(behalten('a', [0, 0, 500, 500]))).toBe('keep');
        expect(editRole({ ...behalten('a', [0, 0, 500, 500]), tgt_bbox: [100, 0, 600, 500] })).toBe('move');
        expect(editRole({ ...behalten('a', [0, 0, 500, 500]), tgt_bbox: null })).toBe('remove');
        expect(editRole({ id: 'a', from: null, src_bbox: null, tgt_bbox: [0, 0, 1, 1], desc: 'x' })).toBe('new');
    });
});

describe('layoutWarnings', () => {
    it('meldet ein Element, das die Szene nicht nennt', () => {
        const hinweise = layoutWarnings('A dome <dome_1> rises from the bay.', [kuppel, menge] as never);
        expect(hinweise).toHaveLength(1);
        expect(hinweise[0]).toContain('crowd_1');
    });

    it('meldet ein <id> ohne Zeile, aber nicht die Referenzbilder', () => {
        const hinweise = layoutWarnings('In <ref_image_0>, the dome <dome_1> and <domee_2>.', [kuppel] as never);
        expect(hinweise).toEqual(['<domee_2> steht im Szenen-Prompt, aber es gibt keine Zeile dazu.']);
    });
});

describe('composePrompt', () => {
    it('hängt die Zeilen als JSON an, durch ein Leerzeichen getrennt', () => {
        const prompt = composePrompt('A dome <dome_1>. ', [kuppel] as never);
        expect(prompt).toBe(`A dome <dome_1>. ${JSON.stringify([kuppel])}`);
    });

    it('hält die Feldreihenfolge aus BFLs Beispielen ein', () => {
        const durcheinander = { desc: 'x', tgt_bbox: [0, 0, 1, 1], id: 'a', src_bbox: null, from: null };
        const prompt = composePrompt('s', [durcheinander] as never);
        expect(prompt).toBe('s [{"id":"a","from":null,"src_bbox":null,"tgt_bbox":[0,0,1,1],"desc":"x"}]');
    });

    it('lässt den Prompt ohne Layout unverändert', () => {
        expect(composePrompt('nur Text', undefined)).toBe('nur Text');
    });
});
