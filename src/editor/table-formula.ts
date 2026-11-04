// ============================================================================
// Formule di cella — il numero che una cella calcola invece di contenerlo.
//
// Una cella può portare una formula (`SUM(ABOVE)`, `AVERAGE(B2:B9)`, `A1*2`,
// `ROUND(C3/3, 2)`). Il testo della cella è il RISULTATO, non la formula: così la
// misura, il foglio di stampa e Word vedono un numero senza dover calcolare
// niente, e il file nativo conserva la formula nell'attributo. Il ricalcolo è del
// plugin (`table-formulas-plugin.ts`): quando un valore cambia, i risultati si
// aggiornano; chi scrive nella cella non tocca la formula.
//
// Il linguaggio è quello di Word, ridotto alle funzioni che servono davvero:
// somma, prodotto, media, minimo, massimo, conteggio, assoluto, intero, segno,
// resto, arrotondamento; le direzioni ABOVE/LEFT/BELOW/RIGHT, i riferimenti A1 e
// gli intervalli A1:B3. Il modello è EdenText `tableFormula.ts` (letto, non
// copiato): le stesse parole, un valutatore più piccolo.
//
// Un intervallo non si ferma alla prima cella non numerica (le celle di testo si
// saltano); una direzione invece sì: è la regola di Word, e serve a delimitare la
// colonna senza doverla contare.
// ============================================================================

/** Le celle della tabella, come testo, riga per riga. */
export type CellGrid = string[][];

export interface CellAddress {
  /** 0-based row. */
  row: number;
  /** 0-based column. */
  col: number;
}

/** Il risultato di una formula: un numero, o niente quando non si può calcolare. */
export type FormulaResult = number | null;

/**
 * Il valore numerico di una cella, o `null` se non è un numero. È la
 * "riconoscenza dei numeri": un numero scritto a mano vale per le formule come un
 * risultato, anche quando porta la valuta o il segno di percentuale che il formato
 * gli ha messo intorno — ma una parola non diventa un numero.
 */
export function numericValueOf(text: string): number | null {
  const trimmed = text.trim();
  if (!/^[-+]?[\d.,\s]*(?:€|%)?$/.test(trimmed) || !/\d/.test(trimmed)) return null;
  const clean = trimmed
    .replace(/[\s€%]/g, "")
    .replace(/\.(?=\d{3}\b)/g, "")
    .replace(",", ".");
  const value = Number(clean);
  return Number.isFinite(value) ? value : null;
}

const COLUMNS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Il nome di una colonna: A, B, … Z, AA, AB… (0-based in, lettere out). */
export function columnName(index: number): string {
  let name = "";
  let n = index;
  do {
    name = COLUMNS[n % 26] + name;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return name;
}

/** Il numero di una colonna dal suo nome (A = 0). */
export function columnIndex(name: string): number {
  let n = 0;
  for (const ch of name.toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}

// ---------------------------------------------------------------------------
// Il linguaggio: i pezzi, il parser, il valutatore.
// ---------------------------------------------------------------------------

type Token =
  | { kind: "number"; value: number }
  | { kind: "ref"; ref: string }
  | { kind: "range"; from: string; to: string }
  | { kind: "name"; name: string }
  | { kind: "op"; op: string };

const FUNCTIONS = new Set([
  "SUM", "PRODUCT", "AVERAGE", "MIN", "MAX", "COUNT",
  "ABS", "INT", "SIGN", "MOD", "ROUND",
]);

const DIRECTIONS = new Set(["ABOVE", "BELOW", "LEFT", "RIGHT"]);

function tokenize(input: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < input.length && /[0-9.]/.test(input[j])) j++;
      const value = Number(input.slice(i, j));
      if (!Number.isFinite(value)) return null;
      tokens.push({ kind: "number", value });
      i = j;
      continue;
    }
    if (/[A-Za-z]/.test(ch)) {
      let j = i;
      while (j < input.length && /[A-Za-z0-9]/.test(input[j])) j++;
      const word = input.slice(i, j).toUpperCase();
      i = j;
      if (input[i] === ":") {
        // Intervallo: A1:B3
        i++;
        let k = i;
        while (k < input.length && /[A-Za-z0-9]/.test(input[k])) k++;
        const to = input.slice(i, k).toUpperCase();
        i = k;
        if (!/^[A-Z]+[0-9]+$/.test(word) || !/^[A-Z]+[0-9]+$/.test(to)) return null;
        tokens.push({ kind: "range", from: word, to });
        continue;
      }
      if (/^[A-Z]+[0-9]+$/.test(word)) tokens.push({ kind: "ref", ref: word });
      else if (FUNCTIONS.has(word) || DIRECTIONS.has(word)) tokens.push({ kind: "name", name: word });
      else return null;
      continue;
    }
    if ("+-*/^(),".includes(ch)) {
      tokens.push({ kind: "op", op: ch });
      i++;
      continue;
    }
    return null;
  }
  return tokens;
}

/** Le coordinate di un riferimento `B3` (0-based). */
function addressOf(ref: string): CellAddress | null {
  const match = /^([A-Z]+)([0-9]+)$/.exec(ref);
  if (!match) return null;
  return { col: columnIndex(match[1]), row: Number(match[2]) - 1 };
}

/** Le celle di un intervallo, riga per riga. */
function rangeCells(from: string, to: string): CellAddress[] | null {
  const a = addressOf(from);
  const b = addressOf(to);
  if (!a || !b) return null;
  const cells: CellAddress[] = [];
  for (let row = Math.min(a.row, b.row); row <= Math.max(a.row, b.row); row++) {
    for (let col = Math.min(a.col, b.col); col <= Math.max(a.col, b.col); col++) {
      cells.push({ row, col });
    }
  }
  return cells;
}

/**
 * La direzione da cui arrivano i valori (`SUM(ABOVE)`): le celle contigue in
 * quella direzione, fermandosi alla prima che non è un numero — la regola di Word.
 */
function directionCells(grid: CellGrid, at: CellAddress, direction: string): number[] {
  const values: number[] = [];
  const step = direction === "ABOVE" ? { row: -1, col: 0 }
    : direction === "BELOW" ? { row: 1, col: 0 }
      : direction === "LEFT" ? { row: 0, col: -1 }
        : { row: 0, col: 1 };
  let row = at.row + step.row;
  let col = at.col + step.col;
  while (row >= 0 && row < grid.length && col >= 0 && col < (grid[row]?.length ?? 0)) {
    const value = numericValueOf(grid[row][col] ?? "");
    if (value === null) break;
    values.push(value);
    row += step.row;
    col += step.col;
  }
  return values;
}

class Parser {
  private index = 0;
  private readonly tokens: Token[];
  private readonly grid: CellGrid;
  private readonly at: CellAddress;

  constructor(tokens: Token[], grid: CellGrid, at: CellAddress) {
    this.tokens = tokens;
    this.grid = grid;
    this.at = at;
  }

  parse(): number | null {
    const value = this.expression();
    return this.index === this.tokens.length ? value : null;
  }

  private peek(token: Token): boolean {
    const current = this.tokens[this.index];
    if (!current) return false;
    if (current.kind === "op" && token.kind === "op") return current.op === token.op;
    return false;
  }

  private eat(op: string): boolean {
    if (!this.peek({ kind: "op", op })) return false;
    this.index++;
    return true;
  }

  private expression(): number | null {
    let value = this.term();
    while (value !== null && (this.peek({ kind: "op", op: "+" }) || this.peek({ kind: "op", op: "-" }))) {
      const op = (this.tokens[this.index] as { op: string }).op;
      this.index++;
      const right = this.term();
      if (right === null) return null;
      value = op === "+" ? value + right : value - right;
    }
    return value;
  }

  private term(): number | null {
    let value = this.factor();
    while (value !== null && (this.peek({ kind: "op", op: "*" }) || this.peek({ kind: "op", op: "/" }))) {
      const op = (this.tokens[this.index] as { op: string }).op;
      this.index++;
      const right = this.factor();
      if (right === null) return null;
      value = op === "*" ? value * right : right === 0 ? null : value / right;
    }
    return value;
  }

  private factor(): number | null {
    const token = this.tokens[this.index];
    if (!token) return null;
    if (token.kind === "op" && token.op === "-") {
      this.index++;
      const value = this.factor();
      return value === null ? null : -value;
    }
    if (token.kind === "op" && token.op === "+") {
      this.index++;
      return this.factor();
    }
    if (token.kind === "number") {
      this.index++;
      return token.value;
    }
    if (token.kind === "ref") {
      this.index++;
      const address = addressOf(token.ref);
      if (!address) return null;
      return numericValueOf(this.grid[address.row]?.[address.col] ?? "");
    }
    if (token.kind === "name") {
      this.index++;
      if (DIRECTIONS.has(token.name)) return null; // solo dentro una funzione
      if (!this.eat("(")) return null;
      return this.call(token.name);
    }
    if (token.kind === "op" && token.op === "(") {
      this.index++;
      const value = this.expression();
      if (!this.eat(")")) return null;
      return value;
    }
    return null;
  }

  /** Gli argomenti di una funzione, già valutati. Una direzione porta le sue celle. */
  private argumentsOf(): number[] | null {
    const values: number[] = [];
    if (this.eat(")")) return values;
    for (;;) {
      const token = this.tokens[this.index];
      if (token?.kind === "name" && DIRECTIONS.has(token.name)) {
        this.index++;
        values.push(...directionCells(this.grid, this.at, token.name));
      } else if (token?.kind === "range") {
        this.index++;
        const cells = rangeCells(token.from, token.to);
        if (!cells) return null;
        for (const cell of cells) {
          const value = numericValueOf(this.grid[cell.row]?.[cell.col] ?? "");
          if (value !== null) values.push(value);
        }
      } else {
        const value = this.expression();
        if (value === null) return null;
        values.push(value);
      }
      if (this.eat(")")) return values;
      if (!this.eat(",")) return null;
    }
  }

  private call(name: string): number | null {
    const args = this.argumentsOf();
    if (!args) return null;
    switch (name) {
      case "ABS":
        return args.length === 1 ? Math.abs(args[0]) : null;
      case "INT":
        return args.length === 1 ? Math.floor(args[0]) : null;
      case "SIGN":
        return args.length === 1 ? Math.sign(args[0]) : null;
      case "MOD":
        return args.length === 2 && args[1] !== 0 ? args[0] % args[1] : null;
      case "ROUND": {
        const digits = args.length === 2 ? Math.round(args[1]) : 0;
        const factor = 10 ** digits;
        return Math.round(args[0] * factor) / factor;
      }
      default:
        return this.aggregate(name, args);
    }
  }

  /** Le funzioni che guardano un gruppo di valori. */
  private aggregate(name: string, values: number[]): number | null {
    switch (name) {
      case "SUM":
        return values.reduce((sum, value) => sum + value, 0);
      case "PRODUCT":
        return values.length === 0 ? 0 : values.reduce((product, value) => product * value, 1);
      case "AVERAGE":
        return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
      case "MIN":
        return values.length === 0 ? null : Math.min(...values);
      case "MAX":
        return values.length === 0 ? null : Math.max(...values);
      case "COUNT":
        return values.length;
      default:
        return null;
    }
  }
}

/**
 * Il numero che la formula produce, nella cella `at` della tabella. `null` quando
 * la formula non si capisce, divide per zero o non ha valori: la cella resta com'è.
 */
export function evaluateFormula(formula: string, grid: CellGrid, at: CellAddress): FormulaResult {
  const clean = formula.trim().replace(/^=/, "");
  if (!clean) return null;
  const tokens = tokenize(clean);
  if (!tokens || tokens.length === 0) return null;
  const value = new Parser(tokens, grid, at).parse();
  if (value === null || !Number.isFinite(value)) return null;
  return value;
}

// ---------------------------------------------------------------------------
// Il formato del numero.
// ---------------------------------------------------------------------------

/** I formati che si possono scegliere; `general` non cambia niente. */
export const CELL_FORMATS = [
  "general",
  "integer",
  "decimal2",
  "thousands",
  "percent",
  "currency",
] as const;

export type CellFormat = (typeof CELL_FORMATS)[number];

/** Le migliaia col punto, i decimali con la virgola: come si scrive in italiano. */
function fixed(value: number, digits: number, grouping: boolean): string {
  const negative = value < 0;
  const [intPart, decPart] = Math.abs(value).toFixed(digits).split(".");
  const int = grouping ? intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".") : intPart;
  const body = decPart === undefined ? int : `${int},${decPart}`;
  return negative ? `-${body}` : body;
}

/** Il numero come va scritto nella cella, secondo il suo formato. */
export function formatCellValue(value: number, format: string | null | undefined): string {
  const chosen = (format ?? "general") as CellFormat;
  switch (chosen) {
    case "integer":
      return String(Math.round(value));
    case "decimal2":
      return fixed(value, 2, false);
    case "thousands":
      return fixed(value, 2, true);
    case "percent":
      return `${fixed(value * 100, 2, true)}%`;
    case "currency":
      return `${fixed(value, 2, true)} €`;
    default: {
      const rounded = Math.round(value * 1e6) / 1e6;
      return fixed(rounded, Number.isInteger(rounded) ? 0 : String(rounded).split(".")[1].length, true);
    }
  }
}
