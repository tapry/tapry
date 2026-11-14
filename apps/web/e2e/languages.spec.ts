// The pages a guest opens follow the guest's language: their browser's, or the one they pick.
// The host's side stays English, and so does what the host is sent.
import { randomBytes } from "node:crypto";
import { createStudio, expect, signInHost, test } from "./fixtures";

test.skip(({ browserName }) => browserName !== "chromium", "the same in every engine");

test("a French-speaking guest gets the invite, the consent, the green room and the room in French; Arabic reads right to left", async ({ page: host, browser }) => {
  await signInHost(host);
  const { inviteUrl } = await createStudio(host, `Langues ${randomBytes(2).toString("hex")}`);
  await host.getByRole("button", { name: "Enter studio" }).click();
  // The host's green room is English whatever the browser.
  await expect(host.getByRole("heading", { name: "Before you go in" })).toBeVisible();
  await host.getByRole("button", { name: "Enter the studio" }).click({ timeout: 20_000 });
  await expect(host.getByText("Connected", { exact: true })).toBeVisible();

  const french = await browser.newContext({ locale: "fr-FR", permissions: ["camera", "microphone"] });
  const guest = await french.newPage();
  await guest.goto(inviteUrl);
  await expect(guest.getByRole("heading", { name: "Dev Host vous invite à enregistrer" })).toBeVisible();
  await expect(guest.getByTestId("consent-text")).toHaveText("J'accepte d'être enregistré. Ma caméra et mon micro sont enregistrés sur cet appareil et envoyés à Dev Host.");
  await expect(guest.getByTestId("language")).toHaveValue("fr");
  await guest.getByLabel("Votre nom").fill("Zoé Invitée");
  await guest.getByRole("checkbox").check();
  await guest.getByRole("button", { name: "Continuer" }).click();

  await expect(guest.getByRole("heading", { name: "Avant d'entrer" })).toBeVisible();
  await expect(guest.locator('[data-check="recorder"]')).toContainText("Enregistrement pris en charge");
  const join = guest.getByRole("button", { name: "Rejoindre le studio" });
  await expect(join).toBeEnabled({ timeout: 20_000 });
  await join.click();
  await expect(guest.getByText("En attente que l'hôte lance l'enregistrement.")).toBeVisible();
  await expect(guest.getByText("Gardez cet onglet ouvert jusqu'à la fin de votre envoi.")).toBeVisible();
  // The host sees the guest, in English.
  await expect(host.getByTestId("participant").filter({ hasText: "Zoé Invitée" })).toBeVisible();
  await french.close();

  // Picking another language keeps it, and Arabic turns the page round.
  const other = await browser.newContext({ locale: "en-US" });
  const page = await other.newPage();
  await page.goto(inviteUrl);
  await expect(page.getByRole("heading", { name: "Dev Host invited you to record" })).toBeVisible();
  await page.getByTestId("language").selectOption("ar");
  await expect(page.getByTestId("language")).toHaveValue("ar");
  await expect(page.locator("[dir=rtl]").first()).toBeVisible();
  await expect(page.getByTestId("consent-text")).toContainText("أوافق على تسجيلي");
  await page.goto(`${inviteUrl}/check`);
  await expect(page.getByText("فحص تقني")).toBeVisible();
  await other.close();
});
