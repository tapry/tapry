// Echo alert over a real call: the guest's "microphone" plays back what the call delivers (what
// speakers leaking into a mic do), the host's sounds like speech. The host should see echo on the
// guest, not on themselves (they only hear their own voice come back).
// Needs LiveKit: `LIVEKIT_BIN=… pnpm test:e2e e2e/echo.spec.ts`.
import { randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";
import { createStudio, expect, signInHost, test } from "./fixtures";

test.skip(!process.env.LIVEKIT_E2E_URL, "needs a LiveKit server (set LIVEKIT_BIN)");
test.skip(({ browserName }) => browserName !== "chromium", "measured once, in Chromium");

/** Replace the mic: "speech" (tone bursts of random length) or "echo" (the call's sound, played back quietly). */
async function fakeMic(page: Page, kind: "speech" | "echo") {
  await page.addInitScript((kind: string) => {
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    let dest: MediaStreamAudioDestinationNode | null = null;
    const start = () => {
      const ctx = new AudioContext({ sampleRate: 48_000 });
      dest = ctx.createMediaStreamDestination();
      void ctx.resume();
      if (kind === "speech") {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = 300;
        gain.gain.value = 0;
        osc.connect(gain).connect(dest);
        osc.start();
        const next = () => {
          gain.gain.value = gain.gain.value > 0 ? 0 : 0.3;
          setTimeout(next, 200 + Math.random() * 1300);
        };
        next();
      } else {
        // Every <audio> the call plays goes back into the mic, 20 dB down.
        const wired = new Set<MediaStream>();
        const gain = ctx.createGain();
        gain.gain.value = 0.1;
        gain.connect(dest);
        setInterval(() => {
          for (const el of document.querySelectorAll("audio")) {
            const src = el.srcObject;
            if (!(src instanceof MediaStream) || wired.has(src) || src.getAudioTracks().length === 0) continue;
            wired.add(src);
            ctx.createMediaStreamSource(src).connect(gain);
          }
        }, 500);
      }
    };
    navigator.mediaDevices.getUserMedia = async (constraints?: MediaStreamConstraints) => {
      const video = constraints?.video ? await getUserMedia({ video: constraints.video }) : null;
      if (!dest) start();
      const tracks = [...(video?.getVideoTracks() ?? [])];
      if (constraints?.audio) tracks.push(dest!.stream.getAudioTracks()[0]!.clone());
      return new MediaStream(tracks);
    };
  }, kind);
}

test("the host sees echo on a guest whose mic picks up the call", async ({ page: host, browser }) => {
  await fakeMic(host, "speech");
  await signInHost(host);
  const { inviteUrl } = await createStudio(host, `Echo ${randomBytes(2).toString("hex")}`);
  await host.getByRole("button", { name: "Enter studio" }).click();
  await host.getByRole("button", { name: "Enter the studio" }).click({ timeout: 20_000 });
  await expect(host.getByText("Connected", { exact: true })).toBeVisible();

  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await fakeMic(guest, "echo");
  await guest.goto(inviteUrl);
  await guest.getByLabel("Your name").fill("Echo Guest");
  await guest.getByRole("checkbox").check();
  await guest.getByRole("button", { name: "Continue" }).click();
  await guest.getByRole("button", { name: "Join the studio" }).click();
  await expect(guest.getByText("Waiting for the host to start recording.")).toBeVisible();

  const guestRow = host.getByTestId("participant").filter({ hasText: "Echo Guest" });
  const hostRow = host.getByTestId("participant").filter({ hasText: "(you)" });
  await expect(guestRow.locator('[data-alert="echo"]')).toHaveText(/Echo/, { timeout: 60_000 });
  await expect(guest.getByTestId("own-alerts")).toContainText("picking up the others from your speakers");
  // Hearing your own voice back isn't your echo.
  await expect(hostRow.locator('[data-alert="echo"]')).toHaveCount(0);

  await guestContext.close();
});
