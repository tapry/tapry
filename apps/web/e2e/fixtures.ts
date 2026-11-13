// Shared helpers for the e2e specs.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test as base, expect, type Locator, type Page } from "@playwright/test";

export const PASSWORD = "e2e-only-throwaway-password";
export const HOST_EMAIL = "host@tapry.test";

export const test = base.extend<{
  /** Hide WebM from MediaRecorder.isTypeSupported, like Safari before 18.4 / iOS. */
  forceMp4: boolean;
}>({
  forceMp4: [false, { option: true }],
  page: async ({ page, forceMp4 }, use) => {
    // Headless browsers still play sound; WebKit has no mute switch, so mute media elements
    // as they start. The tests measure received audio from the streams, not the speakers.
    await page.addInitScript(() => {
      document.addEventListener("play", (e) => ((e.target as HTMLMediaElement).muted = true), true);
    });
    // Record which formats MediaRecorder was actually created with.
    await page.addInitScript((mp4Only: boolean) => {
      const MR = window.MediaRecorder;
      if (!MR) return;
      const w = window as unknown as { __recordedMimeTypes: string[] };
      w.__recordedMimeTypes = [];
      class Spy extends MR {
        constructor(stream: MediaStream, options?: MediaRecorderOptions) {
          super(stream, options);
          w.__recordedMimeTypes.push(options?.mimeType ?? "");
        }
        static isTypeSupported(type: string) {
          return mp4Only && type.includes("webm") ? false : MR.isTypeSupported(type);
        }
      }
      window.MediaRecorder = Spy as typeof MediaRecorder;
    }, forceMp4);
    await use(page);
  },
});

export { expect };

export const recordedMimeTypes = (page: Page) =>
  page.evaluate(() => (window as unknown as { __recordedMimeTypes?: string[] }).__recordedMimeTypes ?? []);

/** Sign up the admin on a fresh server, or sign in when an earlier test already did. */
export async function signInHost(page: Page) {
  await page.goto("/");
  const fresh = await page.getByRole("link", { name: "Create admin account" }).isVisible();
  if (fresh) {
    await page.getByRole("link", { name: "Create admin account" }).click();
    await page.getByLabel("Your name").fill("Dev Host");
    await page.getByLabel("Setup code").fill("e2e-setup-code-12345"); // playwright.config.ts sets SETUP_TOKEN
  } else {
    await page.getByRole("link", { name: "Log in" }).click();
  }
  await page.getByLabel("Email").fill(HOST_EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: fresh ? "Create account" : "Log in" }).click();
  // /studios redirects on to the newest show (or New studio): wait for that, or the test's next
  // navigation races it ("interrupted by another navigation").
  await expect(page).toHaveURL(/\/studios\/(new|std_[\w-]+)$/);
}

/** A new studio (a "studio" in the API), through the New studio page. */
export async function createStudio(page: Page, name: string, opts: { audioOnly?: boolean; fourK?: boolean } = {}) {
  await page.goto("/studios/new");
  await page.getByLabel("What's it called?").fill(name);
  if (opts.audioOnly) await page.getByRole("radio", { name: "Audio only" }).click();
  if (opts.fourK) await page.getByRole("radio", { name: /^4K/ }).click();
  await page.getByRole("button", { name: "Create studio" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  const invite = page.getByLabel("Guest invite link");
  await expect(invite).toHaveValue(/^https?:\/\/.+\/join\//);
  return { studioUrl: page.url(), inviteUrl: await invite.inputValue() };
}

/** Download links of the newest recording's media (transcripts arrive later, separately). */
export const mediaLinks = (page: Page) =>
  page.getByTestId("recording").first().locator('[data-testid="download"]:not([data-file-name^="Transcript."])');

/** The real file names of download links (the links show friendlier titles). */
export const fileNames = (links: Locator) => links.evaluateAll((as) => as.map((a) => a.getAttribute("data-file-name")!));

/** Download every media file of the newest recording through the browser; returns name, type, bytes, duration. */
export async function downloadOutputs(page: Page) {
  const links = await mediaLinks(page).evaluateAll((as) =>
    as.map((a) => ({ href: (a as HTMLAnchorElement).href, name: a.getAttribute("data-file-name")! })),
  );
  const files = [];
  for (const { href, name } of links) {
    // Fetched by the page, following the redirect to signed storage like a real download.
    // Content-Disposition isn't readable cross-origin from page JS, so the name comes from the link.
    const got = await page.evaluate(async (url) => {
      const r = await fetch(url);
      const bytes = new Uint8Array(await r.arrayBuffer());
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { status: r.status, type: r.headers.get("content-type"), base64: btoa(bin) };
    }, href);
    expect(got.status, name).toBe(200);
    const body = Buffer.from(got.base64, "base64");
    const path = join(mkdtempSync(join(tmpdir(), "tapry-dl-")), name);
    writeFileSync(path, body);
    files.push({ name, type: got.type, body, path, duration: probeDuration(path) });
  }
  return files;
}

/** Duration in seconds via ffprobe. */
export function probeDuration(file: string) {
  const out = execFileSync(process.env.FFPROBE_PATH ?? "ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file,
  ]);
  return Number.parseFloat(out.toString());
}

/** The browser's own name for the project, for studio names and messages. */
export const browserLabel = (projectName: string) => projectName.replace(/-/g, " ");
