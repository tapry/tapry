import { ActivityService, CommentsService } from "./collab";
import { ClipsService } from "./clips";
import { TimelineExports } from "./timeline-export";
import { GuideService } from "./guide";
import { NotesService } from "./notes";
import { WaitlistService } from "./waitlist";
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
import { MembersService } from "./members";
import { PaddleBilling, type PaddleOptions } from "./paddle";
import { OwnStorageService, RoutedStorage, StorageTargets, type MakeStorage } from "./own-storage";
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
  /** The project website's origins: allowed to ask "signed in?" and to post to the waitlist. */
  siteOrigins: string[];
  /** Tapry Cloud's waitlist for paid plans. */
  waitlist: WaitlistService;
  /** AI notes: the account's setting, and asking for a recording's notes. */
  notes: NotesService;
  /** The host's guide for a studio, and markers on recordings. */
  guide: GuideService;
  /** Project files for editors that place a recording's files on a timeline. */
  timelines: TimelineExports;
  /** Clips cut out of finished recordings. */
  clips: ClipsService;
  /** Comments on recordings. */
  comments: CommentsService;
  /** The account's activity log. */
  activity: ActivityService;
  /** The admin health page's checks. */
  health: HealthService;
  /** Read-only views across a host's studios: the dashboard's Studios, Guests, Transcripts, Storage and Settings. */
  library: LibraryService;
  /** Seats: the people in an account, and inviting more. */
  members: MembersService;
  /** Accounts' own buckets: setting one up, and which bucket a new session records into. */
  ownStorage: OwnStorageService;
  /** A host's account by email: a new password, confirming the address. */
  account: AccountService;
  /** Tapry Cloud's plans and limits; off (`billing.cloud` false) on a self-hosted server. */
  billing: BillingService;
  /** The payment provider's webhook; null when none is set up. */
  billingWebhook: WebhookConfig | null;
  /** Paddle: verified webhooks into the mirror, and the customer portal. Null without Paddle. */
  paddle: PaddleBilling | null;
}

export function createServices(
  db: Db,
  /** The server's own storage; sessions of accounts with their own bucket are routed past it. */
  serverStorage: Storage,
  opts: { auth: AuthOptions; now?: () => number; hub?: LiveHub; call?: CallConfig | null; guestPromoUrl?: string | null; mailer?: Mailer | null; /** This server's public address, for links in email. */ appUrl?: string | null; bytesPerSecondCap?: number; speedTestOrigins?: string[]; siteOrigins?: string[]; /** The AI notes models this server has set up, by name. */ notes?: { local?: string | null; outside?: string | null }; health?: Omit<HealthOptions, "call">; serverInfo?: ServerInfo; billing?: Omit<BillingOptions, "now">; billingWebhook?: WebhookConfig | null; paddle?: PaddleOptions | null; ownStorage?: { serverKey: string | null; allowPrivate?: boolean; make?: MakeStorage; resolve?: (host: string) => Promise<string[]> } } = {
    auth: { allowSignup: false },
  },
): Services {
  const targets = new StorageTargets(db, opts.ownStorage?.serverKey ?? null, opts.ownStorage?.make);
  const storage: Storage = new RoutedStorage(serverStorage, targets);
  let processing: ProcessingService;
  // Processing is queued when the last track finishes uploading or the host presses Stop,
  // whichever comes last; both paths check whether everything has arrived.
  const maybeProcess = (recordingId: string) =>
    processing.maybeEnqueue(recordingId).catch((err) => console.error("[processing] enqueue failed", err));
  const paddle = opts.paddle && opts.billing?.cloud ? new PaddleBilling(db, opts.paddle) : null;
  const billing = new BillingService(db, {
    cloud: false,
    ...opts.billing,
    portal: paddle?.portalAvailable ? { scheduledChange: (accountId) => paddle.scheduledChange(accountId) } : null,
    now: opts.now,
  });
  const live = new LiveService(db, { now: opts.now, hub: opts.hub, onStopped: maybeProcess, beforeRecording: (sessionId) => billing.checkCanRecord(sessionId) });
  processing = new ProcessingService(db, storage, (sessionId) => live.publishSoon(sessionId));
  const ownStorage = new OwnStorageService(db, targets, {
    serverKey: opts.ownStorage?.serverKey ?? null,
    allowPrivate: opts.ownStorage?.allowPrivate,
    resolve: opts.ownStorage?.resolve,
    // On Tapry Cloud the plan says; a self-hosted server offers it to every account.
    allowed: async (userId, q) => !billing.cloud || (await billing.planOf(userId, q)).ownStorage !== "no",
    required: async (userId, q) => billing.cloud && (await billing.planOf(userId, q)).ownStorage === "required",
  });
  const studios = new StudioService(db, live, () => processing.onEnqueue(), (tx, ownerId) => ownStorage.targetForNewSession(tx, ownerId), (accountId) => billing.allows4k(accountId));
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
    siteOrigins: opts.siteOrigins ?? [],
    waitlist: new WaitlistService(db, { cloud: billing.cloud, now: opts.now }),
    guide: new GuideService(db, opts.now),
    timelines: new TimelineExports(db),
    clips: new ClipsService(db, storage, () => processing.onEnqueue()),
    comments: new CommentsService(db),
    activity: new ActivityService(db, opts.now),
    notes: new NotesService(db, storage, { local: opts.notes?.local ?? null, outside: opts.notes?.outside ?? null, cloud: billing.cloud, now: opts.now, onQueued: () => processing.onEnqueue() }),
    health,
    library: new LibraryService(db, storage, studios, processing, health, opts.serverInfo, opts.now),
    members: new MembersService(db, {
      seats: (accountId, q) => billing.seatsOf(accountId, q),
      mail: opts.mailer && opts.appUrl ? { mailer: opts.mailer, appUrl: opts.appUrl } : null,
      now: opts.now,
    }),
    ownStorage,
    account: new AccountService(db, {
      mail: opts.mailer && opts.appUrl ? { mailer: opts.mailer, appUrl: opts.appUrl } : null,
      requireVerified: billing.cloud,
      now: opts.now,
    }),
    billing,
    billingWebhook: opts.billingWebhook ?? null,
    paddle,
  };
}
