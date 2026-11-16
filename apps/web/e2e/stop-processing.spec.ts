// The host stops a recording's files being made, then has them made after all. A recording left
// running for hours takes hours to process, and there was no way to stop that from the app
// (found on the live server, 16 Nov 2026).
import { randomBytes } from "node:crypto";
import { createStudio, expect, signInHost, test } from "./fixtures";

test("the host stops the files being made, and makes them again", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "the button and the job are the same in every engine");
  test.setTimeout(240_000);
  await signInHost(page);
  const { studioUrl } = await createStudio(page, `Stop ${randomBytes(2).toString("hex")}`);
  await page.getByRole("button", { name: "Enter studio" }).click();
  await page.getByRole("button", { name: "Enter the studio" }).click();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();

  // Long enough that the files take a while to make.
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await expect(page.getByText(/REC 00:0\d/)).toBeVisible();
  await page.waitForTimeout(30_000);
  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect(page.getByTestId("local-upload")).toContainText("All of your recording is uploaded", { timeout: 60_000 });

  await page.goto(studioUrl);
  page.on("dialog", (d) => void d.accept());
  await page.getByTestId("stop-processing").click({ timeout: 30_000 });
  const recording = page.getByTestId("recording").first();
  await expect(recording).toContainText("You stopped this before the files were finished", { timeout: 30_000 });
  await expect(page.getByTestId("stop-processing")).toHaveCount(0);
  await testInfo.attach("stopped", { body: await recording.screenshot(), contentType: "image/png" });

  await recording.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("recording-status").first()).toHaveText(/Ready/, { timeout: 150_000 });
});
