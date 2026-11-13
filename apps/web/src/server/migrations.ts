// Append-only once released. Never edit a migration that has shipped; add a new one.
// Timestamps from the recording clock (server-time ms) are BIGINT; wall-clock audit times are timestamptz.

export const MIGRATIONS: string[] = [
  `
CREATE TABLE users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  is_admin boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Login sessions for hosts (cookie). Not to be confused with recording sessions below.
CREATE TABLE user_sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX user_sessions_user_idx ON user_sessions (user_id);

CREATE TABLE studios (
  id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  -- Shared in the guest link, so stored as-is; rotate it to revoke the link.
  invite_code text NOT NULL UNIQUE,
  settings jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX studios_owner_idx ON studios (owner_id);

-- A live room: the host opens it, guests join it. Holds any number of recordings (takes).
CREATE TABLE sessions (
  id text PRIMARY KEY,
  studio_id text NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'ended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);

CREATE UNIQUE INDEX sessions_one_open_per_studio ON sessions (studio_id) WHERE status = 'open';

CREATE TABLE participants (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id text REFERENCES users(id) ON DELETE SET NULL,
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('host', 'guest')),
  -- SHA-256 of the bearer token; the token itself is never stored.
  token_hash text NOT NULL UNIQUE,
  consented_at timestamptz,
  device_info jsonb,
  clock_offset_ms double precision,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX participants_session_idx ON participants (session_id);

-- One press of Record → Stop.
CREATE TABLE recordings (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'recording' CHECK (status IN ('recording', 'stopped')),
  started_at bigint NOT NULL,
  stopped_at bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX recordings_one_active_per_session ON recordings (session_id) WHERE status = 'recording';

CREATE TABLE tracks (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  recording_id text NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  participant_id text NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('audio', 'video')),
  mime_type text NOT NULL,
  status text NOT NULL DEFAULT 'recording' CHECK (status IN ('recording', 'complete', 'interrupted')),
  started_at bigint NOT NULL,
  stopped_at bigint,
  last_seq integer,
  -- Seqs in 0..last_seq that never arrived. Empty when the track is whole.
  missing_seqs integer[],
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tracks_recording_idx ON tracks (recording_id);

CREATE TABLE chunks (
  track_id text NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  start_ts bigint NOT NULL,
  end_ts bigint NOT NULL,
  bytes bigint NOT NULL,
  sha256 text NOT NULL,
  storage_key text NOT NULL,
  committed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (track_id, seq)
);
`,
  `
-- Post-processing: a recording's chunks become downloadable files.
ALTER TABLE recordings ADD COLUMN processing text NOT NULL DEFAULT 'pending'
  CHECK (processing IN ('pending', 'queued', 'processing', 'ready', 'failed'));
ALTER TABLE recordings ADD COLUMN processed_at timestamptz;
ALTER TABLE recordings ADD COLUMN processing_error text;

-- Work queue in Postgres (claimed with FOR UPDATE SKIP LOCKED): no Redis needed to self-host.
CREATE TABLE jobs (
  id text PRIMARY KEY,
  type text NOT NULL CHECK (type IN ('process_recording')),
  recording_id text NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  run_after timestamptz NOT NULL DEFAULT now(),
  -- A crashed worker's job becomes claimable again once this passes.
  locked_until timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE UNIQUE INDEX jobs_one_open_per_recording ON jobs (recording_id, type) WHERE status IN ('queued', 'running');
CREATE INDEX jobs_claim_idx ON jobs (status, run_after);

CREATE TABLE outputs (
  id text PRIMARY KEY,
  recording_id text NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  participant_id text REFERENCES participants(id) ON DELETE SET NULL,
  track_id text REFERENCES tracks(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('audio', 'video', 'combined')),
  file_name text NOT NULL,
  content_type text NOT NULL,
  storage_key text NOT NULL,
  bytes bigint NOT NULL,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX outputs_recording_idx ON outputs (recording_id);
`,
  `
-- Transcripts: a separate job after processing, so downloads don't wait for Whisper.
ALTER TABLE recordings ADD COLUMN transcript text NOT NULL DEFAULT 'off'
  CHECK (transcript IN ('off', 'queued', 'processing', 'ready', 'failed'));

ALTER TABLE jobs DROP CONSTRAINT jobs_type_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_type_check CHECK (type IN ('process_recording', 'transcribe_recording'));

ALTER TABLE outputs DROP CONSTRAINT outputs_kind_check;
ALTER TABLE outputs ADD CONSTRAINT outputs_kind_check CHECK (kind IN ('audio', 'video', 'combined', 'transcript'));
`,
  `
-- Deleting. A deleted recording keeps its row and its tracks' rows (no media, just ids and
-- times) so a guest still uploading it is told 410 Gone and drops its local copy, instead of
-- retrying forever. Chunks, outputs and the stored files themselves are removed.
ALTER TABLE recordings ADD COLUMN deleted_at timestamptz;
ALTER TABLE studios ADD COLUMN deleted_at timestamptz;

-- Removes a deleted recording's files from storage (twice: see JobRunner.purge).
ALTER TABLE jobs DROP CONSTRAINT jobs_type_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_type_check
  CHECK (type IN ('process_recording', 'transcribe_recording', 'purge_recording'));
`,
  `
-- Episodes are numbered per show ("Episode 41"). Assigned when Record is pressed; numbers of
-- deleted episodes are not reused, so a number always means the same episode.
ALTER TABLE recordings ADD COLUMN number integer;

UPDATE recordings r SET number = n.number FROM (
  SELECT r2.id, row_number() OVER (PARTITION BY s.studio_id ORDER BY r2.started_at, r2.id) AS number
  FROM recordings r2 JOIN sessions s ON s.id = r2.session_id
) n WHERE n.id = r.id;
`,
  `
-- Optional: the original uploads (chunks) of a processed episode are deleted after
-- RAW_RETENTION_DAYS; the processed files stay. Set when that happened.
ALTER TABLE recordings ADD COLUMN raw_deleted_at timestamptz;

ALTER TABLE jobs DROP CONSTRAINT jobs_type_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_type_check
  CHECK (type IN ('process_recording', 'transcribe_recording', 'purge_recording', 'purge_raw'));
`,
  `
-- Guest tech checks: what a guest's browser, devices and connection looked like when they tested
-- before the session, sent to the host by the guest. No media; the newest 50 per show are kept.
CREATE TABLE tech_checks (
  id text PRIMARY KEY,
  studio_id text NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
  name text NOT NULL,
  browser text NOT NULL,
  checks jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tech_checks_studio ON tech_checks (studio_id, created_at DESC);
`,
  `
-- The processing timeline: when each step finished, and what the running job is doing now
-- ({ "stage": "collecting" | "rendering" | "saving" | "transcribing", "done", "total", "current" }).
ALTER TABLE recordings ADD COLUMN uploaded_at timestamptz;
ALTER TABLE recordings ADD COLUMN processing_started_at timestamptz;
ALTER TABLE recordings ADD COLUMN transcribed_at timestamptz;
ALTER TABLE recordings ADD COLUMN progress jsonb;
`,
  `
-- Consent: the exact text each guest agreed to, kept once per distinct text and pointed to by
-- its SHA-256 (hex), next to when they agreed (participants.consented_at).
CREATE TABLE consent_texts (
  hash text PRIMARY KEY,
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE participants ADD COLUMN consent_hash text REFERENCES consent_texts(hash);
`,
  `
-- Every job runner (inside the web server, or a separate worker) says it's alive every 30 s,
-- with what it can do: the admin health page reads this. Rows idle for a day are removed.
CREATE TABLE workers (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('inprocess', 'worker')),
  version text NOT NULL,
  -- { ffmpeg, ffprobe (version lines or null), whisper: { model, modelFound } | null, tmpFreeBytes }
  info jsonb NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  seen_at timestamptz NOT NULL DEFAULT now()
);
`,
  `
-- A guest asked to be emailed their recording. The address is removed once sent or given up on.
CREATE TABLE recap_requests (
  participant_id text PRIMARY KEY REFERENCES participants(id) ON DELETE CASCADE,
  session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  email text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  sends integer NOT NULL DEFAULT 1,
  attempts integer NOT NULL DEFAULT 0,
  run_after timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  -- The emailed link's token, hashed. A new request replaces it, so the old link stops working.
  token_hash text UNIQUE,
  expires_at timestamptz,
  -- The failure's code, never the server's message.
  error text,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX recap_requests_session ON recap_requests (session_id);
CREATE INDEX recap_requests_pending ON recap_requests (created_at) WHERE status = 'pending';
`,
  `
-- Tracks left out of the files because they couldn't be read: { name, kind }, shown to the host.
ALTER TABLE recordings ADD COLUMN skipped_tracks jsonb NOT NULL DEFAULT '[]';
-- A track finished while a render was running, after it had read its chunks: render again.
ALTER TABLE recordings ADD COLUMN rerun_requested boolean NOT NULL DEFAULT false;
`,
  `
-- Filters: what a person chose for how they look and sound ({ brightness, look, touchUp,
-- noiseRemoval }; null: none). The upload is untouched; processing applies them to that
-- person's files, unless the host asked for the files without filters.
ALTER TABLE tracks ADD COLUMN filters jsonb;
ALTER TABLE recordings ADD COLUMN apply_filters boolean NOT NULL DEFAULT true;
`,
  `
-- Files that came out as recorded in the last run because a person's filters couldn't be
-- applied to them: { name, kind }, shown to the host. Written with every run, like skipped_tracks.
ALTER TABLE recordings ADD COLUMN filters_failed jsonb NOT NULL DEFAULT '[]';
`,
  `
-- A "mask" track: a small black-and-white video of where the person is in their picture, which
-- their device records next to the camera when they blur their background. It only helps render
-- their video: it is never a file or a recording of theirs, and is left out wherever tracks are
-- counted or shown (every such query says kind <> 'mask').
ALTER TABLE tracks DROP CONSTRAINT tracks_kind_check;
ALTER TABLE tracks ADD CONSTRAINT tracks_kind_check CHECK (kind IN ('audio', 'video', 'mask'));
`,
  `
-- Tapry Cloud (TAPRY_CLOUD=true) only; a self-hosted server never reads these.
-- The plan an account is on, and what the payment provider last said about its subscription.
ALTER TABLE users ADD COLUMN plan text NOT NULL DEFAULT 'free';
ALTER TABLE users ADD COLUMN plan_status text NOT NULL DEFAULT 'active' CHECK (plan_status IN ('active', 'past_due', 'canceled'));
-- A canceled plan runs until here; after it the account is on Free.
ALTER TABLE users ADD COLUMN plan_ends_at timestamptz;
-- The start of a billing month: recording hours are counted from its day of the month.
ALTER TABLE users ADD COLUMN plan_period_start timestamptz;
ALTER TABLE users ADD COLUMN billing_customer text;
ALTER TABLE users ADD COLUMN billing_subscription text;
-- When the provider says the state above was true: an older webhook never overwrites it.
ALTER TABLE users ADD COLUMN billing_updated_at timestamptz;
CREATE INDEX users_billing_subscription ON users (billing_subscription) WHERE billing_subscription IS NOT NULL;

-- Webhooks already applied, by the provider's event id: each is applied once.
CREATE TABLE billing_events (
  id text PRIMARY KEY,
  received_at timestamptz NOT NULL DEFAULT now()
);

-- Until when a recording's finished files are kept (the plan's days after processing).
-- Null: until someone deletes it, as on every self-hosted server.
ALTER TABLE recordings ADD COLUMN keep_until timestamptz;
CREATE INDEX recordings_keep_until ON recordings (keep_until) WHERE keep_until IS NOT NULL AND deleted_at IS NULL;
`,
  `
-- When the account's email address was confirmed (a link we sent was opened). Null: not yet,
-- which only matters where confirming is required (Tapry Cloud).
ALTER TABLE users ADD COLUMN email_verified_at timestamptz;

-- Links we emailed to an account: to set a new password, or to confirm the address.
-- Only the hash is kept; a link works once, and a newer one of its kind replaces it.
CREATE TABLE account_tokens (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('reset', 'verify')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX account_tokens_user ON account_tokens (user_id);
`,
  `
-- When the host was told by email that this recording's time under their plan is nearly over.
-- Where the server sends email, a recording is only deleted a day or more after this.
ALTER TABLE recordings ADD COLUMN expiry_warned_at timestamptz;
`,
  `
-- Own storage: an account's own S3-compatible bucket. The secret key is encrypted with the
-- server's STORAGE_SECRET_KEY. One row per saved set of settings: replacing or removing them
-- retires the row, which stays for the sessions recorded with it.
CREATE TABLE storage_targets (
  id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint text,
  region text NOT NULL,
  bucket text NOT NULL,
  access_key_id text NOT NULL,
  secret_encrypted text NOT NULL,
  force_path_style boolean NOT NULL,
  -- A test upload from a browser arrived (the bucket's CORS rules let guests upload).
  verified_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX storage_targets_current ON storage_targets (owner_id) WHERE retired_at IS NULL;

-- Where a session's files live: set when the session opens, never changed. Null: the server's storage.
ALTER TABLE sessions ADD COLUMN storage_target_id text REFERENCES storage_targets(id);
`,
  `
-- Seats: the account a person works in. Null: their own (they are its owner). Studios,
-- recordings, the plan and storage belong to the account; signing in stays personal.
ALTER TABLE users ADD COLUMN account_id text REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX users_account ON users (account_id) WHERE account_id IS NOT NULL;

-- Invitations into an account, by a link whose token is kept only hashed. Used once.
CREATE TABLE account_invites (
  id text PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  account_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX account_invites_account ON account_invites (account_id);
`,
  `
-- Paddle's customers and subscriptions, mirrored from verified webhooks and upserted by Paddle's
-- id. Live state: never deleted to tidy up. paddle_updated_at is the entity's own updated_at, so
-- an older delivery arriving late never overwrites a newer state. account_id is the Tapry account
-- the checkout named (its custom data), once known.
CREATE TABLE billing_customers (
  customer_id text PRIMARY KEY,
  -- Null until the customer's own event arrives: a subscription can be delivered first.
  email text,
  account_id text REFERENCES users(id) ON DELETE SET NULL,
  paddle_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX billing_customers_account ON billing_customers (account_id) WHERE account_id IS NOT NULL;

CREATE TABLE billing_subscriptions (
  subscription_id text PRIMARY KEY,
  customer_id text NOT NULL REFERENCES billing_customers(customer_id),
  account_id text REFERENCES users(id) ON DELETE SET NULL,
  status text NOT NULL,
  price_id text NOT NULL,
  product_id text NOT NULL,
  -- The Tapry plan the price sells (BILLING_PRICES); null for a price this server doesn't know.
  plan text,
  scheduled_change_action text,
  scheduled_change_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  paddle_updated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX billing_subscriptions_account ON billing_subscriptions (account_id) WHERE account_id IS NOT NULL;
CREATE INDEX billing_subscriptions_customer ON billing_subscriptions (customer_id);
`,
  `
-- People who asked on the website to hear when Tapry Cloud's paid plans open.
CREATE TABLE waitlist (
  email text PRIMARY KEY,
  plan text,
  created_at timestamptz NOT NULL DEFAULT now()
);
`,
  `
-- A shared screen is a track kind of its own, and a person's "screen" file an output kind.
ALTER TABLE tracks DROP CONSTRAINT tracks_kind_check;
ALTER TABLE tracks ADD CONSTRAINT tracks_kind_check CHECK (kind IN ('audio', 'video', 'mask', 'screen'));
ALTER TABLE outputs DROP CONSTRAINT outputs_kind_check;
ALTER TABLE outputs ADD CONSTRAINT outputs_kind_check CHECK (kind IN ('audio', 'video', 'screen', 'combined', 'transcript'));
`,
  `
-- AI notes: a job of their own after the transcript, a "notes" file, and where each recording's
-- notes stand. ai_outside_at: when the account's owner allowed transcripts to be sent to an
-- outside AI model for notes (null: not allowed, the default).
ALTER TABLE jobs DROP CONSTRAINT jobs_type_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_type_check
  CHECK (type IN ('process_recording', 'transcribe_recording', 'purge_recording', 'purge_raw', 'notes_recording'));
ALTER TABLE outputs DROP CONSTRAINT outputs_kind_check;
ALTER TABLE outputs ADD CONSTRAINT outputs_kind_check CHECK (kind IN ('audio', 'video', 'screen', 'combined', 'transcript', 'notes'));
ALTER TABLE recordings ADD COLUMN notes text NOT NULL DEFAULT 'off' CHECK (notes IN ('off', 'queued', 'processing', 'ready', 'failed'));
ALTER TABLE recordings ADD COLUMN notes_error text;
ALTER TABLE users ADD COLUMN ai_outside_at timestamptz;
`,
  `
-- A producer: a host who is in the call and at the controls, and is never recorded.
ALTER TABLE participants ADD COLUMN producer boolean NOT NULL DEFAULT false;
`,
  `
-- The host's guide for a studio (run of show), and markers: named moments of a recording set
-- by a host while it runs.
ALTER TABLE studios ADD COLUMN guide text NOT NULL DEFAULT '';
CREATE TABLE markers (
  id text PRIMARY KEY,
  recording_id text NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  participant_id text REFERENCES participants(id) ON DELETE SET NULL,
  at_ms bigint NOT NULL,
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX markers_recording ON markers (recording_id, at_ms);
`,
  `
-- Solo links: one person records alone, with no host and no call. Each visit is a session of
-- its own in status 'solo' (so it never counts as the studio's one open live session), whose
-- single participant may start and stop the recording. solo_code is the link's secret (null:
-- off); solo_prompt is what the person is asked.
ALTER TABLE sessions DROP CONSTRAINT sessions_status_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_status_check CHECK (status IN ('open', 'solo', 'ended'));
ALTER TABLE studios ADD COLUMN solo_code text UNIQUE;
ALTER TABLE studios ADD COLUMN solo_prompt text NOT NULL DEFAULT '';
`,
];
