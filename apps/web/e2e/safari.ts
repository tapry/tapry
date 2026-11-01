// Real Safari, driven through Apple's safaridriver (WebDriver), for the specs Playwright's WebKit
// can't stand in for. Needs macOS with Safari > Settings > Developer > "Allow remote automation".
// Automated Safari has mock camera and microphone devices and grants them without a prompt.
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });

const ELEMENT = "element-6066-11e4-a52e-4f735466cecf";
type ElementRef = { [ELEMENT]: string };

export class SafariPage {
  private constructor(
    private driver: ChildProcess,
    private base: string,
  ) {}

  static async launch() {
    const port = await freePort();
    const driver = spawn("safaridriver", ["-p", String(port)], { stdio: "ignore" });
    const base = `http://127.0.0.1:${port}`;
    for (let i = 0; ; i++) {
      try {
        const res = await fetch(`${base}/session`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ capabilities: { alwaysMatch: { browserName: "safari" } } }),
        });
        const body = (await res.json()) as { value: { sessionId?: string; message?: string } };
        if (!body.value.sessionId) throw new Error(`safaridriver: ${body.value.message}`);
        return new SafariPage(driver, `${base}/session/${body.value.sessionId}`);
      } catch (e) {
        if (i >= 20 || (e instanceof Error && e.message.startsWith("safaridriver:"))) {
          driver.kill();
          throw e;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
    }
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.base + path, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json()) as { value: T & { error?: string; message?: string } };
    if (!res.ok) throw new Error(`safaridriver ${path}: ${json.value.message ?? res.status}`);
    return json.value;
  }

  goto(url: string) {
    return this.call("POST", "/url", { url });
  }

  /** Waits for an element found by `find` (a page-side function returning an element or null). */
  async element(find: (arg: string) => Element | null | undefined, arg: string, timeoutMs = 20_000) {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const ref = await this.call<ElementRef | null>("POST", "/execute/sync", {
        script: `return (${find.toString()})(arguments[0]) || null;`,
        args: [arg],
      });
      if (ref) return ref[ELEMENT];
      if (Date.now() > until) {
        const text = await this.call<string>("POST", "/execute/sync", {
          script: `return document.body.innerText + "\\nInputs: " + [...document.querySelectorAll("input")].map((i) => i.name + "=" + (i.type === "checkbox" ? i.checked : i.value)).join(", ")`,
          args: [],
        });
        throw new Error(`Safari: no element for ${JSON.stringify(arg)}. The page says:\n${text.slice(-1500)}`);
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  async click(id: string) {
    await this.call("POST", `/element/${id}/click`, {});
  }

  /** Clicks from inside the page (`element.click()`): for a checkbox that a WebDriver click sometimes misses. */
  async jsClick(id: string) {
    await this.call("POST", "/execute/sync", { script: "arguments[0].click()", args: [{ [ELEMENT]: id }] });
  }

  async type(id: string, text: string) {
    await this.call("POST", `/element/${id}/value`, { text });
  }

  async button(name: string) {
    return this.element(
      (n) => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === n && !b.disabled),
      name,
    );
  }

  async input(label: string) {
    return this.element(
      (l) => [...document.querySelectorAll("label")].find((x) => x.textContent?.includes(l))?.querySelector("input"),
      label,
    );
  }

  async waitForText(text: string, timeoutMs = 20_000) {
    await this.element((t) => (document.body.innerText.includes(t) ? document.body : null), text, timeoutMs);
  }

  async close() {
    await this.call("DELETE", "").catch(() => {});
    this.driver.kill();
  }
}
