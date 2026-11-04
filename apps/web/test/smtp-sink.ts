// A tiny SMTP server for tests: takes every message, keeps the raw text.
import { createServer, type Server } from "node:net";

export interface SunkMail {
  from: string;
  to: string;
  raw: string;
  /** The body with quoted-printable undone, enough to find links and words. */
  decoded: string;
}

export function decodeQuotedPrintable(raw: string) {
  return raw
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

export async function startSmtpSink(port = 0) {
  const mails: SunkMail[] = [];
  /** Say no to the next messages with this reply, like a server that rejects the address. */
  const sink = { mails, rejectWith: null as string | null, port: 0, close: async () => {} };
  const server: Server = createServer((socket) => {
    let from = "";
    let to = "";
    let data: string | null = null;
    let pending = "";
    socket.write("220 sink ESMTP\r\n");
    socket.on("error", () => {});
    socket.on("data", (chunk) => {
      pending += chunk.toString("utf8");
      for (;;) {
        if (data !== null) {
          const end = pending.indexOf("\r\n.\r\n");
          if (end < 0) return;
          const raw = data + pending.slice(0, end);
          pending = pending.slice(end + 5);
          data = null;
          mails.push({ from, to, raw, decoded: decodeQuotedPrintable(raw) });
          socket.write("250 ok\r\n");
          continue;
        }
        const nl = pending.indexOf("\r\n");
        if (nl < 0) return;
        const line = pending.slice(0, nl);
        pending = pending.slice(nl + 2);
        const verb = line.slice(0, 4).toUpperCase();
        if (verb === "MAIL") {
          from = line.slice(10).trim();
          socket.write("250 ok\r\n");
        } else if (verb === "RCPT") {
          to = line.slice(8).trim().replace(/^<|>$/g, "");
          socket.write(sink.rejectWith ? `${sink.rejectWith} <${to}> refused\r\n` : "250 ok\r\n");
        } else if (verb === "DATA") {
          data = "";
          socket.write("354 go\r\n");
        } else if (verb === "QUIT") {
          socket.end("221 bye\r\n");
        } else if (verb === "STAR") {
          socket.write("502 no TLS here\r\n");
        } else {
          socket.write("250 ok\r\n"); // EHLO, RSET, NOOP
        }
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  sink.port = (server.address() as { port: number }).port;
  sink.close = () =>
    new Promise((resolve) => {
      server.close(() => resolve());
      (server as Server & { closeAllConnections?: () => void }).closeAllConnections?.();
    });
  return sink;
}
