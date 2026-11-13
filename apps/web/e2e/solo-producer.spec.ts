// Two ways of not being in the usual seat: recording alone on a studio's solo link (no host, no
// call, the person starts and stops it), and a host who joins as producer (in the call, at the
// controls, never recorded).
import { randomBytes } from "node:crypto";
import { createStudio, downloadOutputs, expect, signInHost, test } from "./fixtures";

test.skip(({ browserName }) => browserName !== "chromium", "the same in every engine");

test("solo link: someone records alone, and it arrives as one of the studio's recordings", async ({ page: host, browser }) => {
  test.setTimeout(300_000);
  await signInHost(host);
  const { studioUrl } = await createStudio(host, `Solo ${randomBytes(2).toString("hex")}`);
  await host.getByRole("tab", { name: "Settings" }).click();
  const card = host.getByTestId("solo-link");
  await card.getByLabel(/What you ask them/).fill("Who are you?\nWhat changed for you this year?");
  await card.getByRole("button", { name: "Turn on the solo link" }).click();
  const link = await card.getByLabel("Solo link").inputValue();
  expect(link).toMatch(/\/solo\/[\w-]+$/);

  const context = await browser.newContext();
  const person = await context.newPage();
  await person.goto(link);
  await expect(person.getByTestId("solo-prompt")).toContainText("What changed for you this year?");
  await person.getByLabel("Your name").fill("Rana Alone");
  await person.getByRole("checkbox").check();
  await person.getByRole("button", { name: "Continue" }).click();
  await person.getByRole("button", { name: "Join the studio" }).click({ timeout: 30_000 });
  // Their questions beside them, and the Record button is theirs.
  await expect(person.getByTestId("guide-panel")).toContainText("Who are you?");
  await person.getByRole("button", { name: "Record", exact: true }).click();
  await person.waitForTimeout(4_000);
  await person.getByRole("button", { name: "Stop recording" }).click();
  await person.getByTestId("solo-finish").click();
  await expect(person.getByTestId("session-ended")).toBeVisible();

  await host.goto(studioUrl);
  await expect(host.getByTestId("recording-status").first()).toHaveText(/Ready/, { timeout: 240_000 });
  const files = await downloadOutputs(host);
  expect(files.map((f) => f.name)).toEqual(expect.arrayContaining(["Rana Alone - audio.wav", "Rana Alone - video.mp4"]));
  expect(files.find((f) => f.name === "Rana Alone - audio.wav")!.duration).toBeGreaterThan(3);
  await context.close();
});

test("producer: in the call and at the controls, not in the recording", async ({ page: host, browser }) => {
  test.setTimeout(300_000);
  await signInHost(host);
  const { studioUrl, inviteUrl } = await createStudio(host, `Producer ${randomBytes(2).toString("hex")}`);
  await host.getByRole("button", { name: "Enter studio" }).click();
  await host.getByTestId("join-as-producer").check();
  await host.getByRole("button", { name: "Enter the studio" }).click({ timeout: 30_000 });
  await expect(host.getByText("Connected", { exact: true })).toBeVisible();

  const context = await browser.newContext();
  const guest = await context.newPage();
  await guest.goto(inviteUrl);
  await guest.getByLabel("Your name").fill("Sam Guest");
  await guest.getByRole("checkbox").check();
  await guest.getByRole("button", { name: "Continue" }).click();
  await guest.getByRole("button", { name: "Join the studio" }).click({ timeout: 30_000 });
  await expect(guest.getByText("Waiting for the host to start recording.")).toBeVisible();

  await host.getByRole("button", { name: "Record", exact: true }).click();
  await expect(host.getByTestId("producer-row")).toHaveText("Producer · not recorded");
  await host.waitForTimeout(4_000);
  await host.getByRole("button", { name: "Stop recording" }).click();
  // Only the guest has anything to upload, and nothing warns about the producer not recording.
  await expect(host.getByTestId("participant-upload")).toHaveText([/✓ Uploaded/], { timeout: 120_000 });
  await expect(host.getByTestId("not-recording-yet")).toHaveCount(0);

  await host.goto(studioUrl);
  await expect(host.getByTestId("recording-status").first()).toHaveText(/Ready/, { timeout: 240_000 });
  const names = (await downloadOutputs(host)).map((f) => f.name);
  expect(names).toContain("Sam Guest - audio.wav");
  expect(names.filter((n) => n.startsWith("Dev Host"))).toEqual([]);
  await context.close();
});
