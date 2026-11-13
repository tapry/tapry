// After a recording: timeline projects, a clip, a comment, a public share page (and taking it
// back), an API key that reads the recording, and a calendar invite for the next session.
import { randomBytes } from "node:crypto";
import { createStudio, expect, signInHost, test } from "./fixtures";

test.skip(({ browserName }) => browserName !== "chromium", "the same in every engine");

test("after a recording: timelines, a clip, a comment, sharing, an API key and a calendar invite", async ({ page: host, browser, request }) => {
  test.setTimeout(420_000);
  await signInHost(host);
  const { studioUrl } = await createStudio(host, `After ${randomBytes(2).toString("hex")}`);
  const studioId = /\/studios\/([\w-]+)/.exec(studioUrl)![1]!;

  // A calendar invite for a session, made in the page.
  await host.getByTestId("schedule-open").click();
  await host.getByLabel("Day").fill("2027-01-15");
  await host.getByLabel("Time").fill("14:30");
  const [invite] = await Promise.all([host.waitForEvent("download"), host.getByRole("button", { name: "Download the invite" }).click()]);
  expect(invite.suggestedFilename()).toMatch(/^Recording - After \w+\.ics$/);

  await host.getByRole("button", { name: "Enter studio" }).click();
  await host.getByRole("button", { name: "Enter the studio" }).click({ timeout: 30_000 });
  await host.getByRole("button", { name: "Record", exact: true }).click();
  await host.waitForTimeout(7_000);
  await host.getByRole("button", { name: "Stop recording" }).click();
  await expect(host.getByTestId("participant-upload")).toHaveText([/✓ Uploaded/], { timeout: 120_000 });
  await host.goto(studioUrl);
  await expect(host.getByTestId("recording-status").first()).toHaveText(/Ready/, { timeout: 240_000 });
  const recordingId: string = await host.evaluate(async (id) => (await (await fetch(`/api/studios/${id}/recordings`)).json()).recordings[0].id, studioId);
  await host.goto(`/recordings/${recordingId}`);

  // Timeline projects for editors.
  const otioHref = (await host.getByTestId("timelines").getByRole("link", { name: "OpenTimelineIO" }).getAttribute("href"))!;
  const otio = await host.evaluate(async (href) => (await fetch(href)).json(), otioHref);
  expect(otio.OTIO_SCHEMA).toBe("Timeline.1");
  expect(otio.tracks.children.map((t: { name: string }) => t.name)).toContain("Dev Host");

  // A clip, cut by the worker.
  const clips = host.getByTestId("clips");
  await clips.getByLabel("From").fill("0:01");
  await clips.getByLabel("To", { exact: true }).fill("0:04");
  await clips.getByLabel("Name (optional)").fill("The middle");
  await clips.getByRole("button", { name: "Cut the clip" }).click();
  await expect(clips.getByTestId("clip")).toHaveAttribute("data-status", "ready", { timeout: 120_000 });
  await expect(clips.getByRole("link", { name: "Download" })).toHaveAttribute("data-file-name", "Clip 00.01-00.04 - The middle.mp4");

  // A comment at a moment.
  const comments = host.getByTestId("comments");
  await comments.getByLabel("At (optional)").fill("0:03");
  await comments.getByLabel("Comment").fill("Good answer here");
  await comments.getByRole("button", { name: "Add" }).click();
  await expect(comments.getByTestId("comment")).toContainText("Dev Host at 00:03");

  // The share page: nobody sees it until it's on; then anyone with the link can play it; then it's gone again.
  const share = host.getByTestId("share");
  await share.getByRole("button", { name: "Share this recording" }).click();
  await expect(share).toHaveAttribute("data-shared", "yes");
  const link = await share.getByLabel("Share link").inputValue();
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(link);
  const media = visitor.getByTestId("shared-media");
  await expect.poll(() => media.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30_000 }).toBeGreaterThan(0);
  await visitor.goto(link.replace("/share/", "/embed/"));
  await expect(visitor.getByTestId("shared-media")).toBeVisible();
  await share.getByRole("button", { name: "Stop sharing" }).click();
  await expect(share).toHaveAttribute("data-shared", "no");
  await visitor.goto(link);
  await expect(visitor.getByTestId("share-gone")).toBeVisible();
  await visitor.context().close();

  // An API key reads the recording, and can't do the owner's things.
  await host.goto("/settings?tab=account");
  const panel = host.getByTestId("integrations");
  await panel.getByLabel("What it is for").fill("Test script");
  await panel.getByRole("button", { name: "Make a key" }).click();
  const key = await panel.getByTestId("integration-secret").locator("input").inputValue();
  expect(key).toMatch(/^tpk_/);
  const base = new URL(studioUrl).origin;
  const listed = await request.get(`${base}/api/studios/${studioId}/recordings`, { headers: { authorization: `Bearer ${key}` } });
  expect(listed.status()).toBe(200);
  expect((await listed.json()).recordings[0].outputs.map((o: { kind: string }) => o.kind)).toContain("clip");
  expect((await request.post(`${base}/api/keys`, { headers: { authorization: `Bearer ${key}` }, data: { name: "x" } })).status()).toBe(403);
  // What happened is in the owner's activity log.
  await host.goto("/settings?tab=members");
  await expect(host.getByTestId("activity")).toContainText("made an API key");
  await expect(host.getByTestId("activity")).toContainText("cut a clip");
});
