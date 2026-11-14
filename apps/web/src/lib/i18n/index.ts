// The languages of the pages a guest opens: the invite, the tech check, the solo link, the
// green room, the room as a guest sees it and the end screen. The host's dashboard is English.
// English is the source: every other language has exactly its keys (the types say so, and a
// test checks the placeholders match).
import { ar } from "./messages/ar";
import { de } from "./messages/de";
import { en } from "./messages/en";
import { es } from "./messages/es";
import { fr } from "./messages/fr";
import { pt } from "./messages/pt";

export const LOCALES = ["en", "fr", "es", "de", "pt", "ar"] as const;
export type Locale = (typeof LOCALES)[number];
export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;

/** Each language's own name, for the picker. */
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", fr: "Français", es: "Español", de: "Deutsch", pt: "Português", ar: "العربية" };

export const MESSAGES: Record<Locale, Messages> = { en, fr, es, de, pt, ar };

/** The cookie a guest's own choice is kept in (a year). Without it, the browser's languages decide. */
export const LOCALE_COOKIE = "tapry-lang";

export const isLocale = (v: unknown): v is Locale => typeof v === "string" && (LOCALES as readonly string[]).includes(v);
export const dirOf = (locale: Locale) => (locale === "ar" ? "rtl" : "ltr");

/** The guest's choice if they made one, else the first of the browser's languages we have, else English. */
export function pickLocale(cookie: string | null | undefined, acceptLanguage: string | null | undefined): Locale {
  if (isLocale(cookie)) return cookie;
  const wanted = (acceptLanguage ?? "")
    .split(",")
    .map((part) => {
      const [tag, q] = part.trim().split(";q=");
      return { tag: (tag ?? "").toLowerCase(), q: q === undefined ? 1 : Number(q) };
    })
    .filter((x) => x.tag && x.q > 0)
    .sort((a, b) => b.q - a.q);
  for (const { tag } of wanted) {
    const base = tag.split("-")[0];
    if (isLocale(base)) return base;
  }
  return "en";
}

export type Vars = Record<string, string | number>;

/** A message in a language, with `{name}` places filled in. An unknown language reads as English. */
export function translate(locale: Locale, key: MessageKey, vars?: Vars): string {
  const text = (MESSAGES[locale] ?? en)[key] ?? en[key];
  return vars ? text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole)) : text;
}

/** A message that is looked up by a code from elsewhere (an error code, a check's id): null when there is none. */
export function translateMaybe(locale: Locale, key: string, vars?: Vars): string | null {
  return key in en ? translate(locale, key as MessageKey, vars) : null;
}

export type T = (key: MessageKey, vars?: Vars) => string;
