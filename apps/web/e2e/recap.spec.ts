// The guest's recap email, through a real SMTP conversation: asked for on the end screen, sent
// when their file is ready, and its link opens only their own file, with no account.
import { randomBytes } from "node:crypto";
import { startSmtpSink } from "../test/smtp-sink";
import { createStudio, expect, signInHost, test } from "./fixtures";

test.skip(({ browserName }) => browserName !== "chromium", "the same in every engine");
test.skip(!!process.env.E2E_BASE_URL, "needs this test's mail server in the server's settings");

test("a guest asks for their recording by email, and the link opens their own file", async ({ page: host, browser }) => {
  const sink = await startSmtpSink(2525); // playwright.config.ts points the server here
  try {
    await signInHost(host);
    const { inviteUrl } = await createStudio(host, `Recap ${randomBytes(2).toString("hex")}`);
    await host.getByRole("button", { name: "Enter studio" }).click();
    await host.getByRole("button", { name: "Enter the studio" }).click({ timeout: 20_000 });
    await expect(host.getByText("Connected", { exact: true })).toBeVisible();

    const guestContext = await browser.newContext();
    const guest = await guestContext.newPage();
    await guest.goto(inviteUrl);
    await guest.getByLabel("Your name").fill("Sam Guest");
    await guest.getByRole("checkbox").check();
    await guest.getByRole("button", { name: "Continue" }).click();
    await guest.getByRole("button", { name: "Join the studio" }).click();
    await expect(guest.getByText("Waiting for the host to start recording.")).toBeVisible();

    await host.getByRole("button", { name: "Record", exact: true }).click();
    await host.waitForTimeout(4_000);
    await host.getByRole("button", { name: "Stop recording" }).click();
    await expect(host.getByTestId("participant-upload")).toHaveText([/✓ Uploaded/, /✓ Uploaded/], { timeout: 60_000 });
    host.once("dialog", (d) => d.accept());
    await host.getByRole("button", { name: "End session" }).click();
    await expect(guest.getByTestId("session-ended")).toContainText("All done!", { timeout: 30_000 });

    const recap = guest.getByTestId("recap-email");
    await guest.getByLabel("Email me a link to my recording").fill("sam@guest.test");
    await guest.getByRole("button", { name: "Email me" }).click();
    // Waits for processing if that's still going; "pending" can pass too quickly to see.
    await expect(recap).toHaveAttribute("data-status", "sent", { timeout: 120_000 });
    await expect(recap).toContainText("works for 30 days");
    await expect(recap).not.toContainText("sam@guest.test");

    expect(sink.mails).toHaveLength(1);
    const [mail] = sink.mails;
    expect(mail!.to).toBe("sam@guest.test");
    expect(mail!.from).toContain("studio@tapry.test");
    expect(mail!.decoded).toContain("Record your own"); // GUEST_PROMO_URL is set in these tests
    const link = /http:\/\/localhost:\d+\/recap\/[\w-]+/.exec(mail!.decoded)![0];

    // Someone with just the link, in a browser that never joined.
    const emailContext = await browser.newContext();
    const reader = await emailContext.newPage();
    await reader.goto(link);
    await expect(reader.getByRole("heading", { name: "Your recording" })).toBeVisible();
    const files = reader.getByTestId("own-recording").locator("a[data-file-name]");
    await expect(files).toHaveCount(2);
    expect(await files.evaluateAll((as) => as.map((a) => a.getAttribute("data-file-name")))).toEqual([
      "Sam Guest - audio.wav",
      "Sam Guest - video.mp4",
    ]);
    expect(await reader.evaluate(async (url) => (await fetch(url!)).status, await files.first().getAttribute("href"))).toBe(200);
    expect(await reader.locator('meta[name="robots"]').getAttribute("content")).toContain("noindex");

    await reader.goto(link.replace(/[\w-]{5}$/, "wrong"));
    await expect(reader.getByRole("heading", { name: "This link no longer works" })).toBeVisible();
    await emailContext.close();
    await guestContext.close();
  } finally {
    await sink.close();
  }
});
