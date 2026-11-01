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
];
