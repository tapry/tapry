// The studio's keyboard shortcuts (advertised on the website): ⌘/Ctrl+Shift+R, M and L.
import { randomBytes } from "node:crypto";
import { createStudio, expect, signInHost, test } from "./fixtures";

test.skip(({ browserName }) => browserName !== "chromium", "same handlers in every engine");

test("host shortcuts: record and stop, mute and unmute, copy the invite link", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signInHost(page);
  const { inviteUrl } = await createStudio(page, `Keys ${randomBytes(2).toString("hex")}`);
  await page.getByRole("button", { name: "Enter studio" }).click();
  await page.getByRole("button", { name: "Enter the studio" }).click({ timeout: 20_000 });
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();

  await page.keyboard.press("ControlOrMeta+Shift+R");
  // The confirmation first: it shows at once and for under two seconds, while the clock waits for the server.
  await expect(page.getByTestId("shortcut-flash")).toHaveText("Recording started");
  await expect(page.getByText(/REC 00:[01]\d/)).toBeVisible();

  await page.keyboard.press("ControlOrMeta+Shift+M");
  await expect(page.getByTestId("self-tile")).toHaveAttribute("data-mic", "muted");
  await expect(page.getByTestId("self-tile").getByTestId("mic-indicator")).toHaveAttribute("data-state", "muted");
  await page.keyboard.press("ControlOrMeta+Shift+M");
  await expect(page.getByTestId("self-tile")).toHaveAttribute("data-mic", "on");
  // Unmuted: the mic is shown as on (or as speaking, while the test microphone's tone is heard).
  await expect(page.getByTestId("self-tile").getByTestId("mic-indicator")).toHaveAttribute("data-state", /^(on|speaking)$/);

  await page.keyboard.press("ControlOrMeta+Shift+L");
  await expect(page.getByTestId("shortcut-flash")).toHaveText("Invite link copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(inviteUrl);

  await page.keyboard.press("ControlOrMeta+Shift+R");
  await expect(page.getByText("Not recording")).toBeVisible();
});
