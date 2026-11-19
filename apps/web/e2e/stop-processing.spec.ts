// The host stops a recording's files being made, then has them made after all. A recording left
// running for hours takes hours to process, and there was no way to stop that from the app
// (found on the live server, 16 Nov 2026).
import { randomBytes } from "node:crypto";
import { createStudio, expect, signInHost, test } from "./fixtures";

test("the host stops the files being made, and makes them again", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "the button and the job are the same in every engine");
  test.setTimeout(240_000);
  await signInHost(page);
  // A 4K studio: Chromium's test camera delivers 4K, whose files take long enough to make that Stop always arrives in time.
  const { studioUrl } = await createStudio(page, `Stop ${randomBytes(2).toString("hex")}`, { fourK: true });
  await page.getByRole("button", { name: "Enter studio" }).click();
  await page.getByRole("button", { name: "Enter the studio" }).click();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();

  // The studio page, open in a second tab before the recording stops: the button is pressed
  // the moment the files start being made, not after a page load that a quick job can outrun.
  const studio = await page.context().newPage();
  await studio.goto(studioUrl);
  studio.on("dialog", (d) => void d.accept());

  // Long enough that the files take a while to make.
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await expect(page.getByText(/REC 00:0\d/)).toBeVisible();
  // Now that there is a recording, the studio page shows it and keeps itself current.
  await studio.reload();
  await page.waitForTimeout(30_000);
  await page.getByRole("button", { name: "Stop recording" }).click();

  // The new recording's card is closed on a page that was opened before it existed: open it.
  const row = studio.getByTestId("recording").first().getByRole("button").first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  if ((await row.getAttribute("aria-expanded")) !== "true") await row.click();
  await studio.getByTestId("stop-processing").click({ timeout: 90_000 });
  const recording = studio.getByTestId("recording").first();
  await expect(recording).toContainText("You stopped this before the files were finished", { timeout: 30_000 });
  await expect(studio.getByTestId("stop-processing")).toHaveCount(0);
  await testInfo.attach("stopped", { body: await recording.screenshot(), contentType: "image/png" });

  await recording.getByRole("button", { name: "Try again" }).click();
  await expect(studio.getByTestId("recording-status").first()).toHaveText(/Ready/, { timeout: 150_000 });
});
