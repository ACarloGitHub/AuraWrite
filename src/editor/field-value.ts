/**
 * E5 — the value of a date, time or name field, with no framework in it.
 *
 * The contract (catalogo, §2): «Un atomo che mostra un valore e si aggiorna;
 * nel formato è un campo, non testo». One catalog of formats, built from field
 * tokens, and ONE renderer: the screen, the page calculator, the HTML export
 * and the DOCX field picture all read the same string ([[concepts/editor-enrichment-fields]]).
 *
 * Two rules the rest of the program depends on:
 *  - the atom SHOWS `text`, a string it carries. Nobody renders a clock while
 *    drawing: the page calculator measures the document, and a date that
 *    changes between the measure and the paint is a guaranteed disagreement
 *    (law D13). `value` keeps the moment, so a refresh or a change of language
 *    can re-render it;
 *  - a format is a KEY of the catalog or a Word picture (`dd.MM.yyyy`). A
 *    picture we do not know stays a picture: the field survives as a field
 *    instead of freezing into text.
 *
 * Adapted from EdenText (`Tests/edentext/src/lib/utils/dateTime.ts`): same
 * token vocabulary and same Word picture letters, because those are the ones
 * Word writes and re-reads.
 */

export type FieldKind = "date" | "time" | "name";

export type Token =
  | { t: "lit"; s: string }
  | { t: "year"; long: boolean }
  | { t: "month"; style: "num" | "num2" | "longText" | "shortText" }
  | { t: "day"; pad: boolean }
  | { t: "weekday"; long: boolean }
  | { t: "hour24"; pad: boolean }
  | { t: "hour12"; pad: boolean }
  | { t: "minute" }
  | { t: "second" }
  | { t: "ampm" };

export interface DtFormat {
  /** Stable key stored on the node and round-tripped through our own files. */
  key: string;
  kind: "date" | "time";
  tokens: Token[];
}

export const DATE_FORMATS: DtFormat[] = [
  // 25.11.2026 — the Italian default, and Word's most common picture.
  { key: "dmy_dots", kind: "date", tokens: [
    { t: "day", pad: true }, { t: "lit", s: "." }, { t: "month", style: "num2" },
    { t: "lit", s: "." }, { t: "year", long: true } ] },
  { key: "iso", kind: "date", tokens: [
    { t: "year", long: true }, { t: "lit", s: "-" }, { t: "month", style: "num2" },
    { t: "lit", s: "-" }, { t: "day", pad: true } ] },
  { key: "mdy_slash", kind: "date", tokens: [
    { t: "month", style: "num" }, { t: "lit", s: "/" }, { t: "day", pad: false },
    { t: "lit", s: "/" }, { t: "year", long: true } ] },
  { key: "dmy_slash", kind: "date", tokens: [
    { t: "day", pad: true }, { t: "lit", s: "/" }, { t: "month", style: "num2" },
    { t: "lit", s: "/" }, { t: "year", long: true } ] },
  // 25. novembre 2026 — month name in the document's language (Intl).
  { key: "dmy_long", kind: "date", tokens: [
    { t: "day", pad: false }, { t: "lit", s: ". " }, { t: "month", style: "longText" },
    { t: "lit", s: " " }, { t: "year", long: true } ] },
  { key: "mdy_long", kind: "date", tokens: [
    { t: "month", style: "longText" }, { t: "lit", s: " " }, { t: "day", pad: false },
    { t: "lit", s: ", " }, { t: "year", long: true } ] },
  // mercoledì 25. novembre 2026
  { key: "weekday_dmy", kind: "date", tokens: [
    { t: "weekday", long: true }, { t: "lit", s: ", " }, { t: "day", pad: false },
    { t: "lit", s: ". " }, { t: "month", style: "longText" }, { t: "lit", s: " " },
    { t: "year", long: true } ] },
  { key: "weekday_mdy", kind: "date", tokens: [
    { t: "weekday", long: true }, { t: "lit", s: ", " }, { t: "month", style: "longText" },
    { t: "lit", s: " " }, { t: "day", pad: false }, { t: "lit", s: ", " },
    { t: "year", long: true } ] },
  // The picture East Asian documents write a date in.
  { key: "ymd_cjk", kind: "date", tokens: [
    { t: "year", long: true }, { t: "lit", s: "年" }, { t: "month", style: "num" },
    { t: "lit", s: "月" }, { t: "day", pad: false }, { t: "lit", s: "日" } ] },
];

export const TIME_FORMATS: DtFormat[] = [
  { key: "hm24", kind: "time", tokens: [
    { t: "hour24", pad: true }, { t: "lit", s: ":" }, { t: "minute" } ] },
  { key: "hms24", kind: "time", tokens: [
    { t: "hour24", pad: true }, { t: "lit", s: ":" }, { t: "minute" },
    { t: "lit", s: ":" }, { t: "second" } ] },
  { key: "hm12", kind: "time", tokens: [
    { t: "hour12", pad: false }, { t: "lit", s: ":" }, { t: "minute" },
    { t: "lit", s: " " }, { t: "ampm" } ] },
  { key: "hms12", kind: "time", tokens: [
    { t: "hour12", pad: false }, { t: "lit", s: ":" }, { t: "minute" },
    { t: "lit", s: ":" }, { t: "second" }, { t: "lit", s: " " }, { t: "ampm" } ] },
];

export const DEFAULT_DATE_FORMAT = "dmy_dots";
export const DEFAULT_TIME_FORMAT = "hm24";

const BY_KEY = new Map<string, DtFormat>(
  [...DATE_FORMATS, ...TIME_FORMATS].map((f) => [f.key, f]),
);

const PICTURE_TOKENS: Record<string, Token> = {
  yyyy: { t: "year", long: true }, yy: { t: "year", long: false },
  MMMM: { t: "month", style: "longText" }, MMM: { t: "month", style: "shortText" },
  MM: { t: "month", style: "num2" }, M: { t: "month", style: "num" },
  dddd: { t: "weekday", long: true }, ddd: { t: "weekday", long: false },
  dd: { t: "day", pad: true }, d: { t: "day", pad: false },
  HH: { t: "hour24", pad: true }, H: { t: "hour24", pad: false },
  hh: { t: "hour12", pad: true }, h: { t: "hour12", pad: false },
  mm: { t: "minute" }, m: { t: "minute" }, ss: { t: "second" }, s: { t: "second" },
  "AM/PM": { t: "ampm" }, "am/pm": { t: "ampm" }, "A/P": { t: "ampm" },
};

// `mm` is a MINUTE and `MM` a month — the letters Word itself reads that way.
const PICTURE_RE = /yyyy|yy|MMMM|MMM|MM|M|dddd|ddd|dd|d|HH|H|hh|h|mm|m|ss|s|AM\/PM|am\/pm|A\/P|'[^']*'/g;

const TIME_TOKENS = ["hour24", "hour12", "minute", "second", "ampm"];
const DATE_TOKENS = ["year", "month", "day", "weekday"];

/** A Word field picture (`dd.MM.yyyy`) → tokens; null when it names no field. */
export function parsePicture(picture: string): Token[] | null {
  const out: Token[] = [];
  let literal = "";
  let last = 0;
  PICTURE_RE.lastIndex = 0;
  for (let m = PICTURE_RE.exec(picture); m; m = PICTURE_RE.exec(picture)) {
    literal += picture.slice(last, m.index);
    last = m.index + m[0].length;
    const token = PICTURE_TOKENS[m[0]];
    if (!token) {
      // A quoted run is a literal, as it is inside the field itself.
      literal += m[0].slice(1, -1);
      continue;
    }
    if (literal) out.push({ t: "lit", s: literal });
    literal = "";
    out.push({ ...token });
  }
  literal += picture.slice(last);
  if (literal) out.push({ t: "lit", s: literal });
  return out.some((t) => t.t !== "lit") ? out : null;
}

/** A clock with no calendar in it is a time; everything else is a date. */
export function pictureKind(tokens: Token[]): "date" | "time" {
  const hasTime = tokens.some((t) => TIME_TOKENS.includes(t.t));
  const hasDate = tokens.some((t) => DATE_TOKENS.includes(t.t));
  return hasTime && !hasDate ? "time" : "date";
}

/** The picture Word writes for these tokens, and reads back. */
export function docxPicture(fmt: DtFormat): string {
  let out = "";
  for (const tok of fmt.tokens) {
    switch (tok.t) {
      case "lit": out += tok.s; break;
      case "year": out += tok.long ? "yyyy" : "yy"; break;
      case "month":
        out += tok.style === "num" ? "M" : tok.style === "num2" ? "MM"
          : tok.style === "longText" ? "MMMM" : "MMM";
        break;
      case "day": out += tok.pad ? "dd" : "d"; break;
      case "weekday": out += tok.long ? "dddd" : "ddd"; break;
      case "hour24": out += tok.pad ? "HH" : "H"; break;
      case "hour12": out += tok.pad ? "hh" : "h"; break;
      case "minute": out += "mm"; break;
      case "second": out += "ss"; break;
      case "ampm": out += "AM/PM"; break;
    }
  }
  return out;
}

/**
 * A stored format → its tokens. A catalog key wins; otherwise the string is
 * read as a Word picture, which is what a field imported from Word carries.
 */
export function findFormat(key: string | null | undefined, kind: "date" | "time"): DtFormat | null {
  if (key) {
    const known = BY_KEY.get(key);
    if (known) return known;
    const tokens = parsePicture(key);
    if (tokens) {
      // A picture that renders exactly like a catalog format IS that format:
      // the key stays stable across a Word file and the panel can point at it.
      const same = [...DATE_FORMATS, ...TIME_FORMATS]
        .find((f) => JSON.stringify(f.tokens) === JSON.stringify(tokens));
      return same ?? { key, kind: pictureKind(tokens), tokens };
    }
  }
  const fallback = kind === "time" ? DEFAULT_TIME_FORMAT : DEFAULT_DATE_FORMAT;
  return BY_KEY.get(fallback) ?? null;
}

/** The moment a fresh field captures: local time, no offset, second precision. */
export function toIsoLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    + `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** An ISO local moment back to a Date; null when the string is not one. */
export function fromIsoLocal(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!m) return null;
  const date = new Date(
    Number(m[1]), Number(m[2]) - 1, Number(m[3]),
    Number(m[4]), Number(m[5]), Number(m[6] ?? 0),
  );
  return isNaN(date.getTime()) ? null : date;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Render a format for a moment, in the document's language. Month and weekday
 * names come from Intl; a month beside a day is asked for WITH the day, so a
 * language that inflects the month (Russian, Greek) gives the genitive a date
 * is written in, not the stand-alone name.
 */
export function renderFormat(fmt: DtFormat, when: Date, locale: string): string {
  const intl = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, opts).format(when);
  const monthName = (style: "long" | "short"): string => {
    const parts = new Intl.DateTimeFormat(locale, { month: style, day: "numeric" }).formatToParts(when);
    return parts.find((p) => p.type === "month")?.value ?? "";
  };
  let out = "";
  for (const tok of fmt.tokens) {
    switch (tok.t) {
      case "lit": out += tok.s; break;
      case "year": out += tok.long ? String(when.getFullYear()) : pad2(when.getFullYear() % 100); break;
      case "month":
        if (tok.style === "num") out += String(when.getMonth() + 1);
        else if (tok.style === "num2") out += pad2(when.getMonth() + 1);
        else out += monthName(tok.style === "longText" ? "long" : "short");
        break;
      case "day": out += tok.pad ? pad2(when.getDate()) : String(when.getDate()); break;
      case "weekday": out += intl({ weekday: tok.long ? "long" : "short" }); break;
      case "hour24": out += tok.pad ? pad2(when.getHours()) : String(when.getHours()); break;
      case "hour12": {
        const h = ((when.getHours() + 11) % 12) + 1;
        out += tok.pad ? pad2(h) : String(h);
        break;
      }
      case "minute": out += pad2(when.getMinutes()); break;
      case "second": out += pad2(when.getSeconds()); break;
      case "ampm": out += when.getHours() < 12 ? "AM" : "PM"; break;
    }
  }
  return out;
}

/** What a field of this kind/format would show right now, in this language. */
export function renderFieldValue(
  kind: FieldKind,
  format: string,
  when: Date,
  locale: string,
  name = "",
): string {
  if (kind === "name") return name;
  const fmt = findFormat(format, kind === "time" ? "time" : "date");
  return fmt ? renderFormat(fmt, when, locale) : "";
}

/** The string a field shows. The cache is the truth: never a new clock here. */
export function fieldText(attrs: Record<string, unknown> | null | undefined): string {
  const text = attrs?.text;
  return typeof text === "string" ? text : "";
}