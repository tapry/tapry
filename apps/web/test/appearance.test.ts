// Light or dark: the person's choice for this browser, or their system's. The script that
// runs before the first paint must come to the same answer as the code that runs after.
import { describe, expect, it } from "vitest";
import { APPEARANCE_KEY, APPEARANCE_SCRIPT, isAppearance, themeFor } from "../src/lib/appearance";

/** Runs the page's script against a made-up browser and says which theme it set. */
function run(stored: string | null | Error, systemDark: boolean | Error) {
  const documentElement = { dataset: {} as Record<string, string> };
  const fake = {
    document: { documentElement },
    localStorage: {
      getItem: (k: string) => {
        if (stored instanceof Error) throw stored;
        return k === APPEARANCE_KEY ? stored : null;
      },
    },
    window: {
      matchMedia: () => {
        if (systemDark instanceof Error) throw systemDark;
        return { matches: systemDark };
      },
    },
  };
  new Function("document", "localStorage", "window", APPEARANCE_SCRIPT)(fake.document, fake.localStorage, fake.window);
  return documentElement.dataset.theme;
}

describe("appearance", () => {
  it("is the person's choice, and the system's when they leave it to the system", () => {
    expect(themeFor("light", true)).toBe("light");
    expect(themeFor("dark", false)).toBe("dark");
    expect(themeFor("system", true)).toBe("dark");
    expect(themeFor("system", false)).toBe("light");
    expect(isAppearance("dark")).toBe(true);
    expect(isAppearance("sepia")).toBe(false);
  });

  it("is set before the first paint by a script that agrees with it", () => {
    for (const systemDark of [true, false]) {
      expect(run("light", systemDark)).toBe("light");
      expect(run("dark", systemDark)).toBe("dark");
      expect(run(null, systemDark)).toBe(themeFor("system", systemDark));
      expect(run("system", systemDark)).toBe(themeFor("system", systemDark));
      // Something else in storage: as if nothing was chosen.
      expect(run("sepia", systemDark)).toBe(themeFor("system", systemDark));
    }
  });

  it("follows the system where storage is blocked, and is light where nothing can be known", () => {
    expect(run(new Error("blocked"), true)).toBe("dark");
    expect(run(new Error("blocked"), false)).toBe("light");
    expect(run(new Error("blocked"), new Error("no matchMedia"))).toBe("light");
  });
});
