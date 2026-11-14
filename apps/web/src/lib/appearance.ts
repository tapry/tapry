// Light or dark: the person's own choice for this browser, or their system's when they leave
// it at that. Kept in localStorage (it is how this browser looks, not something about the
// account) and turned into data-theme="light|dark" on <html>, which is what the styles read.

export const APPEARANCES = ["system", "light", "dark"] as const;
export type Appearance = (typeof APPEARANCES)[number];

/** localStorage key. Written out, not through stored.ts: the script below runs before any module loads. */
export const APPEARANCE_KEY = "tapry:appearance";

export const isAppearance = (v: unknown): v is Appearance => typeof v === "string" && (APPEARANCES as readonly string[]).includes(v);

/** The theme a choice comes to, given whether the system is dark. */
export const themeFor = (choice: Appearance, systemDark: boolean): "light" | "dark" => (choice === "system" ? (systemDark ? "dark" : "light") : choice);

/**
 * Runs in <head>, before anything is painted, so a dark page never flashes white. Plain
 * old JavaScript on purpose: it is put in the page as text. Storage can be blocked: then it
 * follows the system.
 */
export const APPEARANCE_SCRIPT = `(function(){var d=document.documentElement,c="system";try{c=localStorage.getItem(${JSON.stringify(APPEARANCE_KEY)})||"system"}catch(e){}var s=false;try{s=window.matchMedia("(prefers-color-scheme: dark)").matches}catch(e){}d.dataset.theme=c==="dark"||(c!=="light"&&s)?"dark":"light"})();`;

export function readAppearance(): Appearance {
  try {
    const v = localStorage.getItem(APPEARANCE_KEY);
    return isAppearance(v) ? v : "system";
  } catch {
    return "system";
  }
}

const systemDark = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;

/** Show the page in what `choice` comes to right now. */
export function applyAppearance(choice: Appearance) {
  document.documentElement.dataset.theme = themeFor(choice, systemDark());
}

/** Keep the choice for this browser and show it at once. */
export function saveAppearance(choice: Appearance) {
  try {
    if (choice === "system") localStorage.removeItem(APPEARANCE_KEY);
    else localStorage.setItem(APPEARANCE_KEY, choice);
  } catch {
    // Not kept (private mode): it still applies to this page.
  }
  applyAppearance(choice);
}

/**
 * Follow the system while the choice is "system", and a change made in another tab. Returns
 * how to stop.
 */
export function followAppearance(): () => void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const again = () => applyAppearance(readAppearance());
  const onStorage = (e: StorageEvent) => {
    if (e.key === APPEARANCE_KEY || e.key === null) again();
  };
  media.addEventListener("change", again);
  window.addEventListener("storage", onStorage);
  return () => {
    media.removeEventListener("change", again);
    window.removeEventListener("storage", onStorage);
  };
}
