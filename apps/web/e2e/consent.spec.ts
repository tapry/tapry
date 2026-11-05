// Consent per studio: the host writes what guests agree to, guests see exactly that, and each
// guest's agreement is kept with the text (by its SHA-256) and the time, in the consent record.
import { createHash } from "node:crypto";
import { randomBytes } from "node:crypto";
import { createStudio, expect, signInHost, test } from "./fixtures";

test.skip(({ browserName }) => browserName !== "chromium", "the same in every engine");

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

test("guests agree to the studio's own consent text, and the record says who agreed to what", async ({ page: host, browser }) => {
  await signInHost(host);
  const { studioUrl, inviteUrl } = await createStudio(host, `Consent ${randomBytes(2).toString("hex")}`);

  const setConsent = async (text: string) => {
    await host.goto(studioUrl);
    await host.getByRole("tab", { name: "Settings" }).click();
    await host.getByLabel("What guests agree to").fill(text);
    await host.getByRole("button", { name: "Save changes" }).click();
    await expect(host.getByText("✓ Saved")).toBeVisible();
  };
  const first = "I agree to take part in this interview for the Long Table study.";
  await setConsent(first);

  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await guest.goto(inviteUrl);
  await expect(guest.getByTestId("consent-text")).toHaveText(first);

  await test.step("the host changes it while the guest is reading: they're shown the new text", async () => {
    const second = "I agree to take part in this interview.\nQuotes may be used without my name.";
    await setConsent(second);
    await guest.getByLabel("Your name").fill("Ana Guest");
    await guest.getByRole("checkbox").check();
    await guest.getByRole("button", { name: "Continue" }).click();
    await expect(guest.getByText("The host has just changed what you're agreeing to")).toBeVisible();
    await expect(guest.getByTestId("consent-text")).toHaveText(second);
    await expect(guest.getByRole("checkbox")).not.toBeChecked();
  });

  // Now they agree to the new text, and record.
  await host.getByRole("button", { name: "Enter studio" }).click();
  await host.getByRole("button", { name: "Enter the studio" }).click({ timeout: 20_000 });
  await expect(host.getByText("Connected", { exact: true })).toBeVisible();
  await guest.getByRole("checkbox").check();
  await guest.getByRole("button", { name: "Continue" }).click();
  await guest.getByRole("button", { name: "Join the studio" }).click({ timeout: 20_000 });
  await expect(guest.getByText("Waiting for the host to start recording.")).toBeVisible();
  await host.getByRole("button", { name: "Record", exact: true }).click();
  await host.waitForTimeout(3_000);
  await host.getByRole("button", { name: "Stop recording" }).click();
  await expect(host.getByTestId("participant-upload")).toHaveText([/✓ Uploaded/, /✓ Uploaded/], { timeout: 60_000 });

  await host.goto(studioUrl);
  const href = await host.getByTestId("consent-record").first().getAttribute("href");
  const record = await host.evaluate(async (url) => (await fetch(url!)).text(), href);
  const second = "I agree to take part in this interview.\nQuotes may be used without my name.";
  expect(record).toMatch(/^Consent record: Consent [0-9a-f]{4}, Recording 1\n/);
  expect(record).toMatch(new RegExp(`Ana Guest \\(guest\\): agreed \\d{4}-[\\d-]+T[\\d:]+Z, to text SHA-256 ${sha256(second)}`));
  expect(record).toContain(`Text SHA-256 ${sha256(second)}:\n${second}`);
  expect(record).not.toContain(first);
  await guestContext.close();
});
