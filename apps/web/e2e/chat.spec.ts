// Text messages in the session: a guest writes, the host sees a count on the Chat button and
// reads it, answers, and someone who joins again gets what was written while they were away.
// It goes through the server, so it doesn't need the call.
import { randomBytes } from "node:crypto";
import { chromium, type Page } from "@playwright/test";
import { createStudio, expect, otherPerson, signInHost, test } from "./fixtures";

const messages = (page: Page) => page.getByTestId("chat-message");

test("people in a session write to each other", async ({ page: host }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium" && !process.env.E2E_ALL, "plain requests and text, the same everywhere");
  test.setTimeout(150_000);
  await signInHost(host);
  const { inviteUrl } = await createStudio(host, `Chat ${randomBytes(2).toString("hex")}`);
  await host.getByRole("button", { name: "Enter studio" }).click();
  await host.getByRole("button", { name: "Enter the studio" }).click();

  const browser = await chromium.launch({ channel: "chromium", args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--mute-audio"] });
  try {
    const guest = await (await otherPerson(browser, { permissions: ["camera", "microphone"] })).newPage();
    const join = async () => {
      await guest.goto(inviteUrl);
      await guest.getByLabel("Your name").fill("Mira");
      await guest.getByRole("checkbox").check();
      await guest.getByRole("button", { name: "Continue" }).click();
      await guest.getByRole("button", { name: "Join the studio" }).click();
    };
    await join();

    await guest.getByTestId("chat-button").click();
    await expect(guest.getByTestId("chat-panel")).toContainText("No messages yet");
    await guest.getByPlaceholder("Write a message").fill("Can you hear me?");
    await guest.getByPlaceholder("Write a message").press("Enter");
    await expect(messages(guest)).toHaveText([/You.*Can you hear me\?/]);
    await expect(guest.getByPlaceholder("Write a message")).toHaveValue("");

    // The host hasn't opened the chat: the button counts what's new, by name too.
    await expect(host.getByTestId("chat-unread")).toHaveText("1", { timeout: 15_000 });
    await expect(host.getByRole("button", { name: "Chat (1 new)" })).toBeVisible();
    await host.getByTestId("chat-button").click();
    await expect(messages(host)).toHaveText([/Mira.*Can you hear me\?/]);
    await expect(host.getByTestId("chat-unread")).toHaveCount(0);

    await host.getByPlaceholder("Write a message").fill("Loud and clear");
    await host.getByRole("button", { name: "Send" }).click();
    await expect(messages(guest)).toHaveCount(2, { timeout: 15_000 });
    await expect(messages(guest).nth(1)).toContainText("Loud and clear");
    // Open on the guest's screen, so nothing counts as unread there.
    await expect(guest.getByTestId("chat-unread")).toHaveCount(0);

    // Away and back in the same session: what was written is there.
    await guest.reload();
    await guest.getByRole("button", { name: "Join the studio" }).click();
    await expect(guest.getByTestId("chat-unread")).toHaveText("1", { timeout: 15_000 });
    await guest.getByTestId("chat-button").click();
    await expect(messages(guest)).toHaveCount(2);
  } finally {
    await browser.close();
  }
});
