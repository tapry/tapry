// The website's docs, condensed from docs/self-hosting.md, docs/browser-support.md, docs/costs.md
// and the project rules (CLAUDE.md). Keep in step with them: every number here is in one of those.
export type DocBlock =
  | { kind: "h"; text: string }
  | { kind: "p"; text: string }
  | { kind: "code"; text: string }
  | { kind: "note"; text: string }
  | { kind: "table"; rows: Array<[string, string]> };

export type DocPage = { id: string; section: string; title: string; lede: string; blocks: DocBlock[] };

const H = (text: string): DocBlock => ({ kind: "h", text });
const P = (text: string): DocBlock => ({ kind: "p", text });
const C = (text: string): DocBlock => ({ kind: "code", text });
const N = (text: string): DocBlock => ({ kind: "note", text });
const T = (rows: Array<[string, string]>): DocBlock => ({ kind: "table", rows });

export const DOCS: DocPage[] = [
  {
    id: "quickstart",
    section: "Getting started",
    title: "Quick start",
    lede: "From an empty server to a first recording.",
    blocks: [
      H("Requirements"),
      P("A Linux machine with Docker Engine and Compose v2, at least 2 vCPU and 4 GB of RAM, and 50 GB or more of disk. Four DNS names must point at it: studio.example.com, s3., livekit. and turn.studio.example.com. Open TCP 80, 443 and 7881 and UDP 3478 and 7882; keep everything else closed, TCP 5349 in particular."),
      P("Storage gets its own name because browsers upload recordings straight to it through signed URLs, which only work for the exact host they name. LiveKit and TURN get their own names so they can have their own certificates."),
      H("Install"),
      C("git clone https://github.com/tapry/tapry\ncd tapry/deploy/compose\n./setup.sh studio.example.com you@example.com\ndocker compose up -d"),
      P("setup.sh writes .env with random secrets and prints a setup code. The first run builds the image, which takes a few minutes; release images skip the build (add the TAPRY_IMAGES and TAPRY_VERSION lines from the release notes to .env, then docker compose pull && docker compose up -d --no-build)."),
      N("The first account you create becomes the admin. The sign-up form asks for the setup code that setup.sh printed (SETUP_TOKEN in .env), so nobody who finds your new server first can take it. After that, sign-up is closed unless you set ALLOW_SIGNUP=true."),
      H("Record something"),
      P("Open your domain, create the first account with the setup code, then create a studio. Copy its guest link and open it in a second browser to see the green room, then press Record."),
      H("Try it on your own machine"),
      C("./setup.sh localhost\ndocker compose up -d\n# then open http://localhost"),
      P("No DNS needed: browsers resolve s3.localhost, livekit.localhost and turn.localhost to your machine, and treat localhost as secure for camera and microphone access."),
    ],
  },
  {
    id: "concepts",
    section: "Getting started",
    title: "How recording works",
    lede: "Why Tapry’s files sound better than the call did.",
    blocks: [
      H("Local first"),
      P("Each browser records its own camera and microphone with MediaRecorder, at the studio’s quality, in four-second pieces. Every piece is saved in the browser’s storage on that computer before it is sent."),
      H("Upload during the session"),
      P("Pieces upload while you talk, each one straight to storage through a short-lived signed URL. The browser deletes its copy only once the server has confirmed the piece arrived, and uploading a piece twice is harmless. A dropped connection or a closed tab picks up where it stopped when the guest is back."),
      H("The call is separate"),
      P("The live call (LiveKit) carries 360p copies of the camera and microphone. Nothing the call does reaches the recording, and recording works even when the call can’t connect. Muting or turning the camera off applies to the recording too."),
      H("Alignment"),
      P("Every piece carries a timestamp from the device’s steady clock, corrected by the offset the green room measures against the server. After Stop, the worker lines all tracks up to the moment Record was pressed and cuts them to the recording’s exact length. Measured: about 1–5 ms between people, with no drift over an hour."),
    ],
  },
  {
    id: "green",
    section: "Recording",
    title: "Green room and tech check",
    lede: "What a guest goes through before joining, and what the host sees.",
    blocks: [
      H("Green room checks"),
      T([
        ["browser", "That it can record (and in which format), that browser storage works (it doesn’t in some private windows), and a warning on phones"],
        ["devices", "Camera and microphone pickers with a preview and a level meter"],
        ["headphones", "The guest says whether they wear headphones; without them the host sees a “No headphones” note"],
        ["storage", "Free space for the local copy of the recording"],
        ["connection", "Whether the server answers, and how slowly"],
      ]),
      P("Before joining, each guest agrees to the studio’s consent text; the exact wording and the time are kept for the recording’s consent record."),
      H("Tech-check link"),
      P("Under the invite link on the studio page, hosts find a tech-check link to send before the session. Guests run the same checks plus their upload speed against what the studio needs, and a 5-second test recording they play back locally (never uploaded)."),
      P("Results reach the host only when the guest presses Send: their name, browser and the checks’ outcomes, no media."),
    ],
  },
  {
    id: "alerts",
    section: "Recording",
    title: "Producer alerts",
    lede: "What the host is warned about during a recording, per person.",
    blocks: [
      H("Alerts"),
      T([
        ["distorting", "More than 3 peaks at or above −1 dBFS within 10 s"],
        ["silent", "Below −55 dBFS for 30 s while unmuted"],
        ["too quiet", "5 s of talking in the last 30 s, none of it reaching −38 dBFS"],
        ["echo", "Over 20 s with 5 s of the others talking, the mic’s level follows the call’s sound"],
        ["upload behind", "The oldest piece not yet uploaded is more than 60 s old"],
        ["low on space", "Under 1 GB of browser storage left"],
        ["tab in background", "The guest’s tab is hidden"],
        ["not reporting", "No report from the device for 15 s (offline, asleep, tab closed)"],
      ]),
      P("Each device measures its own microphone and upload and sends only alert codes to the server, never audio. Guests see plain advice for their own alerts; the host sees them next to each name."),
      H("Talk balance"),
      P("Each device counts its own talking and reports the number. The host sees everyone’s share after 30 s of talking in all, and a nudge when one person has done 70% of it after two minutes."),
    ],
  },
  {
    id: "browsers",
    section: "Recording",
    title: "Browsers",
    lede: "What is tested, not what should work.",
    blocks: [
      H("Tested"),
      T([
        ["Chromium (Chrome)", "Recording, processing and the live call; the sync and reliability tests, including an hour with nothing lost"],
        ["Firefox", "Recording (WebM VP8 + Opus), processing and the live call"],
        ["WebKit (Safari’s engine)", "Recording as WebM, and as MP4 the way older Safari does; the live call"],
        ["Safari (real, macOS)", "As the guest in the sync test, with Safari’s test microphone: over an hour every second of its sound is in its file, evenly spaced. The gap between a Safari guest and the host isn’t measured, and the hour’s run hasn’t been repeated since its host-side check was corrected"],
      ]),
      H("Not tested yet"),
      P("Edge (Chromium-based), Android Chrome, Safari on iPhone and iPad, the live call in real Safari, and real cameras and microphones. On phones, recording stops when the tab goes to the background; the green room warns about it. The full matrix is in docs/browser-support.md."),
    ],
  },
  {
    id: "storage",
    section: "Storage",
    title: "Storage configuration",
    lede: "Use the bundled SeaweedFS or your own S3-compatible bucket.",
    blocks: [
      H("Bundled storage"),
      P("By default recordings go to SeaweedFS, which runs in the Compose stack and keeps its data in the seaweedfs-data volume. Browsers reach it at s3.<your domain>."),
      H("Your own bucket"),
      P("Delete the seaweedfs service and the web service’s depends_on entry for it, then in the x-app-env block at the top of docker-compose.yml (shared by web and worker) set:"),
      T([
        ["S3_ENDPOINT", "Your provider’s endpoint"],
        ["S3_PUBLIC_ENDPOINT", "The address browsers use, if different; remove it if it’s the same"],
        ["S3_REGION", "The bucket’s region"],
        ["S3_BUCKET", "The bucket’s name"],
        ["S3_ACCESS_KEY_ID", "Access key"],
        ["S3_SECRET_ACCESS_KEY", "Secret for the key above"],
      ]),
      C("docker compose up -d"),
      N("The provider must accept presigned PUTs with a signed x-amz-checksum-sha256 header (check it with pnpm --filter @tapry/web test:s3 and the S3_E2E_* variables), and the bucket needs CORS allowing PUT and GET from your studio’s address."),
    ],
  },
  {
    id: "outputs",
    section: "Storage",
    title: "Output files",
    lede: "What the worker makes once a recording is stopped and everyone’s upload is in.",
    blocks: [
      H("Per person"),
      T([
        ["<name> - audio.wav", "48 kHz, 16-bit; or .flac when the studio’s audio setting is FLAC"],
        ["<name> - video.mp4", "H.264 and AAC at the studio’s quality (1080p or 720p; in a 4K studio, each camera’s own size up to 4K), aligned to Record"],
        ["<name> - screen.mp4", "Only for someone who shared their screen: 1080p, picture only, black while nothing was shared"],
      ]),
      H("Per recording"),
      T([
        ["Combined.mp4", "Everyone side by side, each tile with the person’s name"],
        ["Combined.wav", "Instead of the video when nobody had a camera on (or an audio-only studio)"],
        ["Transcript.{txt,docx,srt,vtt}", "Each person transcribed separately, merged by time with speaker names"],
        ["Consent record", "Who was recorded, when each guest agreed, and the exact text; also in the zip"],
      ]),
      H("Even volume"),
      P("With “Even out volume” on (the default), each file gets one fixed volume change toward −16 LUFS: no compression or limiting. Peaks stay under −1 dBTP and a quiet track is raised by at most 20 dB, so a peaky voice can land a little under −16."),
      P("Download single files through short-lived signed links, or everything as one zip, streamed by the web container."),
    ],
  },
  {
    id: "costs",
    section: "Storage",
    title: "Space and processing",
    lede: "What a recorded hour costs in disk and CPU, measured.",
    blocks: [
      H("Per person and hour, 1080p"),
      T([
        ["Uploaded originals", "About 3–4 GB"],
        ["Processed files", "About 4.4 GB (WAV, MP4 and a share of the combined video)"],
        ["Processing", "55–70 CPU-minutes"],
        ["Transcription", "About 1 CPU-minute with Whisper base"],
      ]),
      P("A 4K studio records each camera at its best: with a 4K camera that is up to about 11 GB uploaded per person and hour, three times Full HD, and the same again processed. The combined video stays 1080p."),
      P("720p roughly halves the video sizes and the encoding time. Processing scales out: WORKER_REPLICAS=3 docker compose up -d runs three workers on the same queue."),
      H("Keeping originals"),
      P("By default the original uploads are kept next to the processed files. RAW_RETENTION_DAYS=7 removes them seven days after a recording’s files are ready, which saves 40–50% of the space. After that the recording can’t be processed again."),
    ],
  },
  {
    id: "transcripts",
    section: "Transcripts",
    title: "Transcripts",
    lede: "whisper.cpp on your own server, one person at a time.",
    blocks: [
      H("How it works"),
      P("Each person’s audio is transcribed on its own, with the language detected per speaker, so speakers are never confused. The lines are then merged by time into Transcript.txt, .docx, .srt and .vtt with names. They appear a little after the recording’s audio and video files."),
      H("Model and speed"),
      P("The Docker image ships Whisper base (multilingual, 148 MB) and transcription is on by default there. For better accuracy, build with --build-arg WHISPER_MODEL=small and its WHISPER_MODEL_SHA256 (466 MB, about three times slower). It runs on CPU; WHISPER_THREADS (default 4) sets how many cores one transcript uses."),
      C("# deploy/compose/.env: turn transcripts off\nWHISPER_MODEL=\n\ndocker compose up -d"),
    ],
  },
  {
    id: "operating",
    section: "Operating",
    title: "Updates and backups",
    lede: "Keeping a Tapry server running.",
    blocks: [
      H("Update"),
      C("git pull && docker compose up -d --build"),
      P("With release images, set the new TAPRY_VERSION in .env, then docker compose pull && docker compose up -d --no-build. Database migrations run on start. Read the changelog first."),
      H("Backups"),
      P("Back up the postgres-data and seaweedfs-data volumes (or pg_dump plus your storage provider’s replication). Recordings are useless without the database that indexes them."),
      H("Logs"),
      C("docker compose logs -f web worker"),
      P("Logs never contain media, only ids and errors."),
    ],
  },
  {
    id: "health",
    section: "Operating",
    title: "Server health",
    lede: "One page that checks everything a recording depends on.",
    blocks: [
      H("The health page"),
      P("Signed in as the admin, Server health (in the sidebar, /admin/health) checks the database, storage (it writes, reads and deletes a test file), the workers and their ffmpeg, the job queue and recent failures, transcripts, the live call (tested from your browser), free working space and the version."),
      P("GET /api/health returns ok and the version when the app and its database are up."),
      N("Set UPDATE_CHECK_REPO to compare with the latest release. Unset, the server fetches nothing."),
    ],
  },
];

export const DOC_ORDER: Array<[string, string[]]> = [
  ["Getting started", ["quickstart", "concepts"]],
  ["Recording", ["green", "alerts", "browsers"]],
  ["Storage", ["storage", "outputs", "costs"]],
  ["Transcripts", ["transcripts"]],
  ["Operating", ["operating", "health"]],
];

/** Each docs page is its own address; the first one is /docs/ itself. */
export const docHref = (d: Pick<DocPage, "id">) => (d.id === DOCS[0]!.id ? "/docs/" : `/docs/${d.id}/`);

export const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
