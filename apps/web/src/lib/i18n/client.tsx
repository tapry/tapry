"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { ApiRequestError } from "@/lib/client/api";
import { LOCALE_COOKIE, LOCALE_NAMES, LOCALES, translate, translateMaybe, type Locale, type T } from ".";

const LocaleContext = createContext<Locale>("en");

/** Everything inside reads in `locale`. Outside any provider (the host's pages) it is English. */
export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useT(): { locale: Locale; t: T } {
  const locale = useContext(LocaleContext);
  return useMemo(() => ({ locale, t: (key, vars) => translate(locale, key, vars) }), [locale]);
}

/**
 * What to show for a failed request: the server's own words in English, and in another language
 * our words for that error code where we have them (the server only speaks English).
 */
export function errorText(err: unknown, locale: Locale, fallback: string): string {
  if (!(err instanceof ApiRequestError)) return fallback;
  if (locale === "en") return err.message;
  return translateMaybe(locale, `error.${err.code}`) ?? err.message;
}

/** The guest's language, changed in place: kept in a cookie for a year, and the page is loaded again in it. */
export function LanguagePicker({ locale, label }: { locale: Locale; label: string }) {
  return (
    <label className="flex items-center gap-2 text-[13px] text-white/85">
      <span className="sr-only">{label}</span>
      <svg viewBox="0 0 24 24" className="size-[15px]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 2a10 10 0 1 0 0 20a10 10 0 0 0 0-20zM2 12h20M12 2a15.3 15.3 0 0 1 0 20a15.3 15.3 0 0 1 0-20z" />
      </svg>
      <select
        value={locale}
        data-testid="language"
        onChange={(e) => {
          document.cookie = `${LOCALE_COOKIE}=${e.target.value}; path=/; max-age=31536000; samesite=lax`;
          window.location.reload();
        }}
        className="cursor-pointer rounded-md border border-white/25 bg-black/25 px-2 py-1 text-[13px] text-white focus:outline-2 focus:outline-white"
      >
        {LOCALES.map((l) => (
          <option key={l} value={l} lang={l} className="text-black">
            {LOCALE_NAMES[l]}
          </option>
        ))}
      </select>
    </label>
  );
}
