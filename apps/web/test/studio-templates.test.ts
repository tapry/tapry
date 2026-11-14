// Studio templates only fill the new-studio form in: what they carry must be something the
// server accepts as a studio, and their guides and consent texts must fit.
import { createStudioBody, guideBody, soloSettingsBody, studioSettings } from "@tapry/shared";
import { describe, expect, it } from "vitest";
import { parseGuide } from "../src/lib/guide";
import { STUDIO_TEMPLATES, templateConsent } from "../src/lib/studio-templates";

describe("studio templates", () => {
  it("each makes a studio the server accepts, with a guide that has sections and items", () => {
    expect(STUDIO_TEMPLATES.map((t) => t.id)).toEqual(["blank", "podcast", "research", "newsroom", "class"]);
    for (const t of STUDIO_TEMPLATES) {
      const body = createStudioBody.parse({
        name: t.name,
        settings: { maxGuests: t.guests, videoQuality: t.quality === "audio" ? "1080p" : t.quality, audioOnly: t.quality === "audio", ...t.settings, ...(t.consent ? { consentText: templateConsent(t, "Dana Host") } : {}) },
      });
      const settings = studioSettings.parse(body.settings);
      expect(settings.maxGuests, t.id).toBe(t.guests);
      expect(guideBody.parse({ guide: t.guide }).guide, t.id).toBe(t.guide);
      if (t.id === "blank") continue;
      const lines = parseGuide(t.guide);
      expect(lines.filter((l) => l.kind === "section").length, t.id).toBeGreaterThanOrEqual(2);
      expect(lines.filter((l) => l.kind === "item").length, t.id).toBeGreaterThanOrEqual(4);
    }
  });

  it("the class template turns the solo link on with an assignment, and deletes recordings after a term", () => {
    const t = STUDIO_TEMPLATES.find((x) => x.id === "class")!;
    expect(t.settings).toEqual({ guestDownloads: true, deleteAfterDays: 120 });
    expect(soloSettingsBody.parse({ enabled: true, prompt: t.solo }).prompt).toBe(t.solo);
    expect(parseGuide(t.solo!).filter((l) => l.kind === "item").length).toBeGreaterThanOrEqual(3);
    // No other template opens a link by itself.
    expect(STUDIO_TEMPLATES.filter((x) => x.solo).map((x) => x.id)).toEqual(["class"]);
  });

  it("the research template is sound only, keeps the files with the researcher and names the host in its consent", () => {
    const t = STUDIO_TEMPLATES.find((x) => x.id === "research")!;
    expect(t).toMatchObject({ quality: "audio", guests: 1, settings: { guestDownloads: false, audioFormat: "flac" } });
    const text = templateConsent(t, "Dana $1 Host");
    expect(text).toContain("sent to Dana $1 Host.");
    expect(text).not.toContain("{host}");
    expect(text).toContain("ask afterwards for my recording to be deleted");
  });
});
