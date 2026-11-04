// Sending email over SMTP: any server or provider works. Off unless SMTP_HOST is set.
import nodemailer from "nodemailer";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
  /** Connect and log in, without sending anything. Throws when that fails. */
  verify(): Promise<void>;
}

export interface SmtpConfig {
  host: string;
  port: number;
  user?: string;
  password?: string;
  from: string;
  /** Allow an unencrypted connection (a mail server on this machine or private network). */
  insecure: boolean;
}

export class SmtpMailer implements Mailer {
  private transport: ReturnType<typeof nodemailer.createTransport>;

  constructor(private config: SmtpConfig) {
    this.transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      requireTLS: !config.insecure && config.port !== 465,
      ignoreTLS: config.insecure,
      auth: config.user ? { user: config.user, pass: config.password ?? "" } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
    });
  }

  async send(message: MailMessage) {
    await this.transport.sendMail({ from: this.config.from, ...message });
  }

  async verify() {
    await this.transport.verify();
  }
}

/**
 * Why sending failed, safe to log and store: the error's code and the server's status, never
 * its message, which can quote the address.
 */
export function mailFailureReason(err: unknown) {
  const e = err as { code?: unknown; responseCode?: unknown };
  const code = typeof e?.code === "string" && /^[A-Z_]+$/.test(e.code) ? e.code : "ERROR";
  return typeof e?.responseCode === "number" ? `${code} (server said ${e.responseCode})` : code;
}
