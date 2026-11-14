// The guest pages' languages: every language has every message with the same {places}, and the
// language is chosen by the guest's own pick, then by what their browser asks for.
import { describe, expect, it } from "vitest";
import { dirOf, LOCALES, MESSAGES, pickLocale, translate, translateMaybe } from "../src/lib/i18n";

const places = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("guest page languages", () => {
  it("has every message in every language, with the same places to fill in", () => {
    const keys = Object.keys(MESSAGES.en).sort();
    for (const locale of LOCALES) {
      expect(Object.keys(MESSAGES[locale]).sort(), locale).toEqual(keys);
      for (const key of keys as Array<keyof typeof MESSAGES.en>) {
        expect(MESSAGES[locale][key].trim(), `${locale} ${key}`).not.toBe("");
        expect(places(MESSAGES[locale][key]), `${locale} ${key}`).toEqual(places(MESSAGES.en[key]));
      }
    }
  });

  it("picks the guest's choice first, then the browser's best language we have, then English", () => {
    expect(pickLocale("de", "fr-FR,fr;q=0.9")).toBe("de");
    expect(pickLocale(undefined, "fr-FR,fr;q=0.9,en;q=0.8")).toBe("fr");
    expect(pickLocale(undefined, "ja,pt-BR;q=0.8,en;q=0.5")).toBe("pt");
    expect(pickLocale(undefined, "en;q=0.3, es;q=0.9")).toBe("es");
    expect(pickLocale("xx", "ar-MA")).toBe("ar");
    expect(pickLocale(undefined, "ja, zh;q=0.9")).toBe("en");
    expect(pickLocale(undefined, null)).toBe("en");
    expect(pickLocale(undefined, "fr;q=0, de")).toBe("de");
  });

  it("fills in the places, leaves unknown ones alone, and reads right to left in Arabic only", () => {
    expect(translate("en", "invite.title", { host: "Dana" })).toBe("Dana invited you to record");
    expect(translate("fr", "invite.title", { host: "Dana" })).toBe("Dana vous invite à enregistrer");
    expect(translate("en", "invite.title")).toBe("{host} invited you to record");
    expect(translateMaybe("es", "error.studio_full")).toBe("Este estudio está completo");
    expect(translateMaybe("es", "error.something_else")).toBeNull();
    expect(LOCALES.map(dirOf)).toEqual(["ltr", "ltr", "ltr", "ltr", "ltr", "rtl"]);
  });
});
