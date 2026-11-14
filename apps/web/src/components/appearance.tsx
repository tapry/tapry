"use client";

import { useEffect, useState } from "react";
import { APPEARANCES, followAppearance, readAppearance, saveAppearance, type Appearance } from "@/lib/appearance";
import { cn } from "./ui";

/** Mounted once for the whole app: keeps the page in step with the system and with other tabs. */
export function AppearanceSync() {
  useEffect(() => followAppearance(), []);
  return null;
}

const NAMES: Record<Appearance, string> = { system: "System", light: "Light", dark: "Dark" };

/** Light, dark, or whatever the computer is set to. Kept in this browser. */
export function AppearancePicker() {
  // Unknown until mounted: the server can't see this browser's choice.
  const [choice, setChoice] = useState<Appearance | null>(null);
  useEffect(() => setChoice(readAppearance()), []);
  return (
    <div role="radiogroup" aria-label="Appearance" className="inline-flex rounded-md border border-border bg-surface-2 p-0.5" data-testid="appearance">
      {APPEARANCES.map((a) => (
        <button
          key={a}
          type="button"
          role="radio"
          aria-checked={choice === a}
          onClick={() => {
            saveAppearance(a);
            setChoice(a);
          }}
          className={cn(
            "cursor-pointer rounded-[5px] px-3 py-1 text-[14px] font-medium transition-colors",
            choice === a ? "bg-surface text-text shadow-xs" : "text-muted hover:text-text",
          )}
        >
          {NAMES[a]}
        </button>
      ))}
    </div>
  );
}
