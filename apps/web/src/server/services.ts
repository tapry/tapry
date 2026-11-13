import { HealthService, type HealthOptions } from "./health";
import { SpeedTestLimiter } from "./speed-test";
import { AccountService } from "./account";
import { AuthService, type AuthOptions } from "./auth";
import { BillingService, type BillingOptions } from "./billing";
import type { WebhookConfig } from "./billing-webhooks";
import { CallService, type CallConfig } from "./call";
import type { Db } from "./db";
import { LibraryService, type ServerInfo } from "./library";
import { LiveHub, LiveService } from "./live";
import type { Mailer } from "./mail";
import { ProcessingService } from "./processing";
import { RecapService } from "./recap";
import type { Storage } from "./storage";
import { StudioService } from "./studios";
import { UploadService } from "./uploads";

export interface Services {
  db: Db;
  storage: Storage;
  auth: AuthService;
  studios: StudioService;
  live: LiveService;
  uploads: UploadService;
  processing: ProcessingService;
  call: CallService;
  /** Guests' recap email, asked for on the end screen. */
  recaps: RecapService;
  /** Where guests' end screen points ("Record your own, free"); null for none. */
  guestPromoUrl: string | null;
  /** The public upload-speed test: per-address limits, and other sites allowed to use it. */
  speedTest: { limiter: SpeedTestLimiter; origins: string[] };
  /** The admin health page's checks. */
  health: HealthService;
  /** Read-only views across a host's studios: the dashboard's Studios, Guests, Transcripts, Storage and Settings. */
  library: LibraryService;
  /** A host's account by email: a new password, confirming the address. */
  account: AccountService;
  /** Tapry Cloud's plans and limits; off (`billing.cloud` false) on a self-hosted server. */
  billing: BillingService;
  /** The payment provider's webhook; null when none is set up. */
  billingWebhook: WebhookConfig | null;
}

export function createServices(
  db: Db,
  storage: Storage,
  opts: { auth: AuthOptions; now?: () => number; hub?: LiveHub; call?: CallConfig | null; guestPromoUrl?: string | null; mailer?: Mailer | null; /** This server's public address, for links in email. */ appUrl?: string | null; bytesPerSecondCap?: number; speedTestOrigins?: string[]; health?: Omit<HealthOptions, "call">; serverInfo?: ServerInfo; billing?: Omit<BillingOptions, "now">; billingWebhook?: WebhookConfig | null } = {
    auth: { allowSignup: false },
  },
): Services {
  let processing: ProcessingService;
  // Processing is queued when the last track finishes uploading or the host presses Stop,
  // whichever comes last; both paths check whether everything has arrived.
  const maybeProcess = (recordingId: string) =>
    processing.maybeEnqueue(recordingId).catch((err) => console.error("[processing] enqueue failed", err));
  const billing = new BillingService(db, { cloud: false, ...opts.billing, now: opts.now });
  const live = new LiveService(db, { now: opts.now, hub: opts.hub, onStopped: maybeProcess, beforeRecording: (sessionId) => billing.checkCanRecord(sessionId) });
  processing = new ProcessingService(db, storage, (sessionId) => live.publishSoon(sessionId));
  const studios = new StudioService(db, live, () => processing.onEnqueue());
  const health = new HealthService(db, storage, { ...opts.health, call: opts.call ?? null, mailer: opts.mailer ?? null });
  return {
    db,
    storage,
    auth: new AuthService(db, { now: opts.now, ...opts.auth }),
    studios,
    live,
    uploads: new UploadService(db, storage, (sessionId) => live.publishSoon(sessionId), maybeProcess, { now: opts.now, bytesPerSecondCap: opts.bytesPerSecondCap }),
    processing,
    call: new CallService(db, opts.call ?? null),
    recaps: new RecapService(db, !!opts.mailer, () => processing.onEnqueue()),
    guestPromoUrl: opts.guestPromoUrl ?? null,
    speedTest: { limiter: new SpeedTestLimiter(undefined, opts.now), origins: opts.speedTestOrigins ?? [] },
    health,
    library: new LibraryService(db, storage, studios, processing, health, opts.serverInfo, opts.now),
    account: new AccountService(db, {
      mail: opts.mailer && opts.appUrl ? { mailer: opts.mailer, appUrl: opts.appUrl } : null,
      requireVerified: billing.cloud,
      now: opts.now,
    }),
    billing,
    billingWebhook: opts.billingWebhook ?? null,
  };
}
