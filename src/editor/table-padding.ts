// ============================================================================
// Il riempimento interno della cella (il margine fra il testo e il bordo).
//
// Sta sulla TABELLA, in centimetri, un valore per lato; `null` è il margine di
// Word, lo stesso che il foglio di stile disegna da sempre: 0,19 cm a destra e a
// sinistra, niente sopra e sotto (108 twip). Il valore viaggia nel file nativo, lo
// disegnano schermo e anteprima (variabili CSS sulla tabella, le stesse per
// entrambi) e Word lo riceve come `w:tblCellMar` in twip.
//
// Tocca QUATTRO posti che devono restare d'accordo — il CSS dell'editor, il foglio
// di stampa, l'esportazione DOCX e la misura dell'impaginazione — ed è per questo
// che è l'ultima voce della famiglia: finché la geometria si muoveva, cambiarla
// qui la faceva litigare con gli altri tre (il tentativo del 02-11 bloccò il
// programma). Il modello è EdenText `tableCellPadding.ts` (letto, non copiato):
// quattro lati in cm, cella che eredita dalla tabella.
// ============================================================================

/** Centimetri per pollice, per passare ai twip di Word (1 cm = 567 twip). */
const TWIPS_PER_CM = 567;

/** Il margine di cella di Word: 0,19 cm a destra e a sinistra. */
export const DEFAULT_CELL_PADDING = { top: 0, right: 0.19, bottom: 0, left: 0.19 } as const;

export interface CellPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type PaddingSide = keyof CellPadding;

export const PADDING_SIDES: PaddingSide[] = ["top", "right", "bottom", "left"];

const MIN_CM = 0;
const MAX_CM = 5;

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * Il riempimento di una tabella: quello che ha, oppure il margine di Word. Un
 * valore che non è un numero, o fuori misura, non passa: la cella non può
 * diventare più larga del foglio per un numero sbagliato.
 */
export function cellPaddingOf(attrs: Record<string, unknown> | null | undefined): CellPadding {
  const raw = attrs?.cellPadding as Partial<CellPadding> | null | undefined;
  if (!raw || typeof raw !== "object") return { ...DEFAULT_CELL_PADDING };
  const read = (side: PaddingSide, fallback: number): number => {
    const value = Number(raw[side]);
    if (!Number.isFinite(value)) return fallback;
    return round2(Math.max(MIN_CM, Math.min(MAX_CM, value)));
  };
  return {
    top: read("top", DEFAULT_CELL_PADDING.top),
    right: read("right", DEFAULT_CELL_PADDING.right),
    bottom: read("bottom", DEFAULT_CELL_PADDING.bottom),
    left: read("left", DEFAULT_CELL_PADDING.left),
  };
}

/** Il padding come dichiarazioni CSS, da mettere sulla tabella (vista e foglio). */
export function cellPaddingVars(padding: CellPadding): Record<string, string> {
  return {
    "--aw-cell-pad-top": `${padding.top}cm`,
    "--aw-cell-pad-right": `${padding.right}cm`,
    "--aw-cell-pad-bottom": `${padding.bottom}cm`,
    "--aw-cell-pad-left": `${padding.left}cm`,
  };
}

/** Il padding nei twip di Word (`w:tblCellMar`). */
export function cellPaddingTwips(padding: CellPadding): CellPadding {
  return {
    top: Math.round(padding.top * TWIPS_PER_CM),
    right: Math.round(padding.right * TWIPS_PER_CM),
    bottom: Math.round(padding.bottom * TWIPS_PER_CM),
    left: Math.round(padding.left * TWIPS_PER_CM),
  };
}

/** `true` quando la tabella porta un riempimento suo (e non il margine di Word). */
export function hasCellPadding(attrs: Record<string, unknown> | null | undefined): boolean {
  const raw = attrs?.cellPadding;
  return !!raw && typeof raw === "object";
}
