import { CODE_FONT, DarkBtn, H1, HERO_BG, LEAD, OutlineBtn, SectionHead, Shell } from "@/components/ui";
import { CLOUD_NEWS, GITHUB, HAS_CLOUD, pageMeta } from "@/content/site";

export const metadata = pageMeta({
  title: "Self-hosting: run Tapry on your own server · Tapry",
  description: "One Linux machine with Docker and four DNS names. Caddy handles HTTPS, SeaweedFS holds the files and a worker makes them. Free, with no limits on recordings or hours.",
  path: "/self-hosting/",
});

// From docs/self-hosting.md and docs/costs.md.
const REQS: Array<[string, string, string]> = [
  ["Machine", "2 vCPU · 4 GB RAM", "More cores process recordings faster"],
  ["OS", "Linux with Docker Engine + Compose v2", "macOS works for trying it out"],
  ["Network", "Four DNS names pointing at it", "TCP 80, 443, 7881 · UDP 3478, 7882"],
  ["Storage", "50 GB+ of disk, or an S3 bucket", "About 3–4 GB uploaded per person-hour at 1080p"],
];

const STEPS: Array<{ n: string; t: string; b: string; code: string }> = [
  {
    n: "01",
    t: "Clone the repository",
    b: "Everything lives in one repo: the web app, the worker, and the Compose bundle under deploy/compose.",
    code: `git clone ${GITHUB}\ncd tapry/deploy/compose`,
  },
  {
    n: "02",
    t: "Run setup",
    b: "Pass your domain and an email for Let’s Encrypt certificates. Setup writes a .env with random secrets and prints the setup code for the first account.",
    code: "./setup.sh studio.example.com you@example.com",
  },
  {
    n: "03",
    t: "Start the stack",
    b: "Caddy, the web app, the worker, Postgres, SeaweedFS and LiveKit come up together. The first run builds the image, which takes a few minutes; the release images skip that.",
    code: "docker compose up -d\ndocker compose logs -f web worker",
  },
  {
    n: "04",
    t: "Create the first account",
    b: "Open your domain and sign up with the setup code. The first account becomes the admin, and sign-up closes after it (ALLOW_SIGNUP=true reopens it). Create a studio and send its guest link to anyone.",
    code: "# in your browser: https://studio.example.com\n# setup code: SETUP_TOKEN in deploy/compose/.env",
  },
];

const PARTS: Array<[string, string, string]> = [
  ["Web", "Next.js app", "Studio, green room, dashboard and API. Each browser records with MediaRecorder in four-second pieces."],
  ["Calls", "LiveKit", "WebRTC for the live call, with a built-in TURN relay on port 443. Only 360p copies go through it; recordings never do."],
  ["Storage", "SeaweedFS or S3", "Pieces upload straight to storage through signed URLs. A browser deletes its copy only once the server confirms it."],
  ["Worker", "Processing", "Aligns every track to the moment Record was pressed, levels toward −16 LUFS, and makes WAV, MP4 and the combined video."],
  ["Transcripts", "whisper.cpp", "Runs on your server, one transcript per person, merged with speaker names. Nothing is sent anywhere."],
];

export default function SelfHostingPage() {
  return (
    <Shell active="self-hosting" label="Self-hosting">
      <section style={{ background: HERO_BG, padding: "80px 32px 64px" }}>
        <div style={{ margin: "0 auto", display: "grid", maxWidth: 1180, gap: "24px 64px", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,420px),1fr))", alignItems: "end" }}>
          <h1 className="rise" style={{ ...H1, textWrap: "balance" }}>
            Run Tapry on your own server
          </h1>
          <div className="rise" style={{ display: "flex", flexDirection: "column", gap: 20, animationDelay: ".08s" }}>
            <p style={LEAD}>One Linux machine, Docker and four DNS names. Caddy handles HTTPS, SeaweedFS holds the files, and a worker makes them. Free, with no limits on recordings or hours.</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <DarkBtn href="#steps">Start the setup</DarkBtn>
              <OutlineBtn href={GITHUB}>View on GitHub</OutlineBtn>
            </div>
          </div>
        </div>
      </section>

      <section style={{ borderTop: "1px solid #ececef", padding: "64px 32px" }}>
        <div style={{ margin: "0 auto", display: "grid", maxWidth: 1180, gap: 1, background: "#ececef", border: "1px solid #ececef", borderRadius: 20, overflow: "hidden", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,220px),1fr))" }}>
          {REQS.map(([k, v, note]) => (
            <div key={k} style={{ display: "flex", flexDirection: "column", gap: 6, background: "#fff", padding: "22px 24px" }}>
              <span style={{ fontSize: 13, color: "#737378" }}>{k}</span>
              <span style={{ fontSize: 16, fontWeight: 500 }}>{v}</span>
              <span style={{ fontSize: 13, color: "#6b6b70" }}>{note}</span>
            </div>
          ))}
        </div>
      </section>

      <section id="steps" style={{ borderTop: "1px solid #ececef", padding: "96px 32px", scrollMarginTop: 64 }}>
        <div style={{ margin: "0 auto", display: "flex", maxWidth: 1180, flexDirection: "column", gap: 48 }}>
          <SectionHead title="Four steps" kicker="Setup" num="1.0" />
          <div style={{ display: "flex", flexDirection: "column" }}>
            {STEPS.map((st) => (
              <div key={st.n} className="reveal40" style={{ display: "grid", gap: "24px 48px", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,380px),1fr))", borderTop: "1px solid #ececef", padding: "40px 0" }}>
                <div style={{ display: "flex", gap: 20 }}>
                  <span style={{ fontSize: 13, color: "#737378", paddingTop: 4, fontVariantNumeric: "tabular-nums" }}>{st.n}</span>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <h3 style={{ margin: 0, fontSize: 20, fontWeight: 500, letterSpacing: "-.02em" }}>{st.t}</h3>
                    <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: "#6b6b70", textWrap: "pretty" }}>{st.b}</p>
                  </div>
                </div>
                <pre tabIndex={0} style={pre}>{st.code}</pre>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section style={{ borderTop: "1px solid #ececef", padding: "96px 32px" }}>
        <div style={{ margin: "0 auto", display: "flex", maxWidth: 1180, flexDirection: "column", gap: 48 }}>
          <SectionHead title="What’s in the box" kicker="Architecture" num="2.0" />
          <div style={{ display: "grid", gap: "40px 32px", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,240px),1fr))" }}>
            {PARTS.map(([k, t, b]) => (
              <div key={k} style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: "1px solid #0b0b0f", paddingTop: 18 }}>
                <span style={{ fontSize: 13, color: "#737378" }}>{k}</span>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 500, letterSpacing: "-.015em" }}>{t}</h3>
                <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: "#6b6b70", textWrap: "pretty" }}>{b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section style={{ borderTop: "1px solid #ececef", padding: "96px 32px" }}>
        <div style={{ margin: "0 auto", display: "grid", maxWidth: 1180, gap: "40px 64px", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,400px),1fr))" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, borderTop: "1px solid #0b0b0f", paddingTop: 20 }}>
            <h3 style={h3}>Use your own bucket</h3>
            <p style={p}>Skip SeaweedFS and point Tapry at S3-compatible storage such as AWS S3, Cloudflare R2 or Backblaze B2. It must accept signed uploads. Set the endpoint, bucket, region and keys in docker-compose.yml, and restart.</p>
            <OutlineBtn href="/docs/storage/" style={{ alignSelf: "flex-start" }}>
              Storage docs
            </OutlineBtn>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, borderTop: "1px solid #0b0b0f", paddingTop: 20 }}>
            <h3 style={h3}>Rather not run a server?</h3>
            <p style={p}>
              {HAS_CLOUD
                ? "Tapry Cloud is the same software, hosted for you. It starts free, with paid plans for more recording hours."
                : `Tapry Cloud is planned: the same software, hosted for you. It isn’t available yet; to hear when it opens, ${CLOUD_NEWS}.`}
            </p>
            <DarkBtn href="/pricing/" style={{ alignSelf: "flex-start" }}>
              See pricing
            </DarkBtn>
          </div>
        </div>
      </section>
    </Shell>
  );
}

const pre = { margin: 0, overflow: "auto", border: "1px solid #ececef", borderRadius: 12, background: "#f7f7f8", padding: "14px 16px", fontFamily: CODE_FONT, fontSize: 13, lineHeight: 1.65, color: "#0b0b0f" } as const;
const h3 = { margin: 0, fontSize: 20, fontWeight: 500, letterSpacing: "-.02em" } as const;
const p = { margin: 0, fontSize: 15, lineHeight: 1.6, color: "#6b6b70", textWrap: "pretty" } as const;
