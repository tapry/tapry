import { cookies, headers } from "next/headers";
import { LOCALE_COOKIE, pickLocale, translate, type Locale, type T } from ".";

/** The language of this request's guest page: their choice (cookie), else their browser's. */
export async function getLocale(): Promise<Locale> {
  const [jar, head] = await Promise.all([cookies(), headers()]);
  return pickLocale(jar.get(LOCALE_COOKIE)?.value, head.get("accept-language"));
}

export async function getT(): Promise<{ locale: Locale; t: T }> {
  const locale = await getLocale();
  return { locale, t: (key, vars) => translate(locale, key, vars) };
}
