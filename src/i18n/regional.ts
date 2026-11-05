// ============================================================================
// Values in the document's language.
//
// One place answers "how is this number written here": the decimal and grouping
// separators come from `Intl`, never from a hand-written table, so every
// language the platform knows is covered. The date is a serial number with
// LibreOffice's own epoch (1899-12-30, the day zero EdenText uses too); the
// language decides how it looks, never what it is.
//
// The language in force is set once at start from the preference (resolved
// "system" included) and again whenever the preference changes. Nothing here
// reads the document: the caller that knows the cell and the document passes the
// tag down, so this module stays usable from the editor without preferences.
// ============================================================================

/**
 * The language a value is written in, right now: a resolved BCP-47 tag such as
 * `it` or `en-GB`, never the word `system`.
 */
let language = "en";

/** Resolve the stored intention: `system` reads the machine at every start. */
export function resolveLanguage(preference: string | null | undefined): string {
  const wanted = (preference ?? "").trim();
  if (!wanted || wanted === "system") {
    const system = typeof navigator !== "undefined" ? navigator.language : "";
    return system || "en";
  }
  return wanted;
}

/** Set the language values are written in; called at start and on a change. */
export function setValuesLanguage(tag: string): void {
  language = resolveLanguage(tag);
}

/** The language values are written in. */
export function valuesLanguage(): string {
  return language;
}

export type NumberLocale = { decimal: string; group: string };

/** The separators the language uses, read from the platform. */
export function numberLocale(lang: string): NumberLocale {
  const parts = new Intl.NumberFormat(lang || "en").formatToParts(1234.5);
  const pick = (type: string, fallback: string): string =>
    parts.find((part) => part.type === type)?.value ?? fallback;
  return { decimal: pick("decimal", "."), group: pick("group", ",") };
}

/**
 * A cell's text as a number, or null when it is text. The reading does not
 * depend on the language in force: a number typed in another convention is still
 * a number (LibreOffice behaves the same way), so `3,5` and `3.5` both read.
 * Spaces (including the no-break and narrow ones) and the grouping separator are
 * noise; beyond one sign and one decimal separator it is text.
 */
export function parseNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!/^[-+]?[\p{Sc}\d.,\s]*(?:%|\p{Sc})?$/u.test(trimmed) || !/\d/.test(trimmed)) return null;
  const percent = trimmed.includes("%");
  let body = trimmed.replace(/[\s%\p{Sc}]/gu, "");
  const hasDot = body.includes(".");
  const hasComma = body.includes(",");
  if (hasDot && hasComma) {
    const decimal = body.lastIndexOf(".") > body.lastIndexOf(",") ? "." : ",";
    const group = decimal === "." ? "," : ".";
    body = body.split(group).join("").replace(decimal, ".");
  } else if (hasComma) {
    body = /^[-+]?\d{1,3}(?:,\d{3})+$/.test(body) ? body.split(",").join("") : body.replace(",", ".");
  } else if (hasDot) {
    body = /^[-+]?\d{1,3}(?:\.\d{3}){2,}$/.test(body) ? body.split(".").join("") : body;
  }
  const value = Number(body);
  if (!Number.isFinite(value)) return null;
  return percent ? value / 100 : value;
}

/** The editor's own rendering: no grouping, the language's decimal separator. */
export function formatGeneral(value: number, lang: string): string {
  const loc = numberLocale(lang);
  const rounded = Math.round(value * 1e10) / 1e10;
  const text = String(rounded);
  return loc.decimal === "." ? text : text.replace(".", loc.decimal);
}

/** A number with a fixed number of decimals, and grouping if asked. */
export function formatDecimal(
  value: number,
  decimals: number,
  grouping: boolean,
  lang: string,
): string {
  return new Intl.NumberFormat(lang || "en", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: grouping,
  }).format(value);
}

// The currency a language spends. `Intl` formats a currency but does not say
// which one a language uses; the region of the locale picks it, with the
// everyday currency of the places that speak it.
const CURRENCY_BY_REGION: Record<string, string> = {
  US: "USD", GB: "GBP", CH: "CHF", RU: "RUB", UA: "UAH", BY: "BYN",
  CN: "CNY", TW: "TWD", HK: "HKD", MO: "MOP", SG: "SGD", JP: "JPY", KR: "KRW",
  IN: "INR", ID: "IDR", MY: "MYR", TH: "THB", VN: "VND", PH: "PHP",
  AU: "AUD", NZ: "NZD", CA: "CAD", MX: "MXN", BR: "BRL", AR: "ARS",
  CL: "CLP", CO: "COP", PE: "PEN", TR: "TRY", IL: "ILS", SA: "SAR",
  AE: "AED", EG: "EGP", ZA: "ZAR", PL: "PLN", SE: "SEK", NO: "NOK",
  DK: "DKK", CZ: "CZK", HU: "HUF", RO: "RON", BG: "BGN",
  // The euro area, including the languages that are spoken in it.
  DE: "EUR", AT: "EUR", FR: "EUR", IT: "EUR", ES: "EUR", PT: "EUR",
  NL: "EUR", BE: "EUR", IE: "EUR", FI: "EUR", GR: "EUR", SK: "EUR",
  SI: "EUR", EE: "EUR", LV: "EUR", LT: "EUR", LU: "EUR", MT: "EUR", CY: "EUR",
};

export function localeCurrency(lang: string): string {
  try {
    const region = new Intl.Locale(lang || "en").maximize().region ?? "US";
    return CURRENCY_BY_REGION[region] ?? "USD";
  } catch {
    return "USD";
  }
}

/** A value written with the language's currency symbol and its position. */
export function formatCurrency(value: number, lang: string): string {
  return new Intl.NumberFormat(lang || "en", {
    style: "currency",
    currency: localeCurrency(lang),
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** A percentage: the number already multiplied by a hundred, plus the sign. */
export function formatPercent(value: number, lang: string): string {
  return `${formatDecimal(value * 100, 2, true, lang)}%`;
}

// LibreOffice's day zero, the same epoch EdenText uses (probed: serial 45000 is
// 15 March 2023). A value outside the calendar stays a number.
const DATE_EPOCH = Date.UTC(1899, 11, 30);

export function serialToDate(serial: number): Date | null {
  const date = new Date(DATE_EPOCH + Math.round(serial) * 86400000);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** A serial number as the language's short date; null when it is no date. */
export function formatDateSerial(serial: number, lang: string): string | null {
  const date = serialToDate(serial);
  if (!date) return null;
  return new Intl.DateTimeFormat(lang || "en", { dateStyle: "short", timeZone: "UTC" })
    .format(date);
}
