import { CtaRow, Chip, DarkBtn, H1, HERO_BG, LEAD, OutlineBtn, Shell } from "@/components/ui";
import { customers } from "@/content/customers";
import { pageMeta } from "@/content/site";

export const metadata = pageMeta({
  title: "Use cases: podcasts, research interviews, newsrooms · Tapry",
  description: "One recorder for podcasts, research interviews, newsrooms and privacy-bound teams: everyone recorded in full quality on their own computer, stored where you say.",
  path: "/use-cases/",
});

const GREEN = "#1f9d55";
const AMBER = "#e0a019";
const GREY = "#c9c9cf";

type UseCase = {
  id: "podcasts" | "research" | "newsrooms" | "privacy";
  num: string;
  eyebrow: string;
  title: string;
  body: string;
  demoLabel: string;
  demo: Array<[string, string, string]>;
  points: Array<[string, string]>;
  /** Where to read more, while there's no customer story for this use case. */
  more: { text: string; label: string; href: string };
};

const USE_CASES: UseCase[] = [
  {
    id: "podcasts",
    num: "1.0",
    eyebrow: "Podcasts",
    title: "Record a podcast remotely without the remote sound",
    body: "Every voice on its own track at full quality, even when a guest’s Wi-Fi gives up halfway. Nothing to install for guests, nothing to re-record for you.",
    demoLabel: "Live recording · The Long Table, Recording 42",
    demo: [
      ["Yasmine (host)", "1080p · 2.6 GB, up to date", GREEN],
      ["Tom", "1080p · 2.4 GB, up to date", GREEN],
      ["Ines", "1080p · 1 min behind, still recording", AMBER],
      ["Talk balance", "46 / 31 / 23", GREY],
    ],
    points: [
      ["Separate tracks, already aligned", "Per person a WAV and an MP4 that start at the moment you pressed Record and share one length."],
      ["Guests just click a link", "A green room checks their browser, camera, microphone and free space, and asks about headphones, before they join."],
      ["A producer’s view", "See who’s too quiet, distorting, echoing or falling behind on upload, as it happens."],
    ],
    more: { text: "Each guest’s recording is saved on their own computer first, so a dropped connection only costs the call.", label: "How recording works", href: "/docs/concepts/" },
  },
  {
    id: "research",
    num: "2.0",
    eyebrow: "Research interviews",
    title: "Interviews with a clear answer for your ethics board",
    body: "Participants join from a link, each one’s consent is kept with the recording, and the audio stays on your institution’s server.",
    demoLabel: "Consent record · Study P-14, Recording 3",
    demo: [
      ["Consent", "Agreed 10:01 · exact wording kept", GREEN],
      ["Storage", "s3://uni-research/tapry", GREEN],
      ["Transcript", "On your server, whisper.cpp", GREEN],
      ["Tapry account, analytics", "None", GREY],
    ],
    points: [
      ["Data stays where you say", "Your server, your bucket, your keys. When you host Tapry yourself, there is no Tapry account that can see the files."],
      ["Consent in the record", "Each participant agrees to the wording you set for the studio. Every recording comes with a consent record: who agreed, when, and to which text."],
      ["Transcripts without a vendor", "whisper.cpp runs on your server and transcribes each person’s track on its own, so every line is labelled with who said it."],
    ],
    more: { text: "Where the audio goes is one sentence: your server and the storage you point it at.", label: "Storage docs", href: "/docs/storage/" },
  },
  {
    id: "newsrooms",
    num: "3.0",
    eyebrow: "Newsrooms",
    title: "From call to timeline without the clean-up",
    body: "Levelled, aligned per-person files and a combined video are made on your server as soon as everyone’s upload is in. They are plain WAV and MP4 files, for the editor you already use.",
    demoLabel: "Files · Recording 118",
    demo: [
      ["Ines - audio.wav", "48 kHz · −16 LUFS", GREEN],
      ["Ines - video.mp4", "1080p · aligned to Record", GREEN],
      ["Combined.mp4", "Rendering", AMBER],
      ["Transcript.srt", "Ready", GREEN],
    ],
    points: [
      ["Even volume by default", "Every track is brought toward −16 LUFS with one volume change and no compression, so voices match without touching a fader."],
      ["One length, one start", "All files start at the moment Record was pressed and are cut to the recording’s exact length."],
      ["Subtitles included", "SRT and VTT alongside TXT and DOCX, with each speaker named."],
    ],
    more: { text: "Per-person WAV or FLAC, MP4, a combined video and four transcript formats.", label: "Output files", href: "/docs/outputs/" },
  },
  {
    id: "privacy",
    num: "4.0",
    eyebrow: "Privacy-bound teams",
    title: "Record sensitive conversations in-house",
    body: "Run Tapry on a server you control. The code is open, the storage is yours, and transcripts are made on the same machine.",
    demoLabel: "Deployment · your server",
    demo: [
      ["Server", "Docker Compose, one machine", GREEN],
      ["HTTPS", "Caddy, certificates from Let’s Encrypt", GREEN],
      ["Storage", "SeaweedFS on your own disk", GREEN],
      ["Sent to Tapry", "Nothing", GREY],
    ],
    points: [
      ["Readable, auditable", "AGPL-3.0 server, MIT recorder core. Logs hold ids and errors, never media."],
      ["Works when the network doesn’t", "Guests record locally even on a poor connection; uploads resume when it’s back."],
      ["One Compose file", "Caddy, Postgres, SeaweedFS, LiveKit, the worker and the web app on a single machine."],
    ],
    more: { text: "Requirements, the four steps and what runs where.", label: "Self-hosting guide", href: "/self-hosting/" },
  },
];

export default function UseCasesPage() {
  return (
    <Shell active="solutions" label="Solutions">
      <section style={{ background: HERO_BG, padding: "80px 32px 64px" }}>
        <div style={{ margin: "0 auto", display: "grid", maxWidth: 1180, gap: "24px 64px", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,420px),1fr))", alignItems: "end" }}>
          <h1 className="rise" style={{ ...H1, textWrap: "balance" }}>
            One studio, four kinds of recording
          </h1>
          <p className="rise" style={{ ...LEAD, animationDelay: ".08s" }}>
            The same recorder underneath: everyone captured in full quality on their own computer, uploaded while you talk, stored where you say. What changes is what you do with it.
          </p>
        </div>
        <div className="rise" style={{ margin: "40px auto 0", display: "flex", maxWidth: 1180, gap: 4, flexWrap: "wrap", animationDelay: ".16s" }}>
          <Chip href="#podcasts">Podcasts</Chip>
          <Chip href="#research">Research interviews</Chip>
          <Chip href="#newsrooms">Newsrooms</Chip>
          <Chip href="#privacy">Privacy-bound teams</Chip>
        </div>
      </section>

      {USE_CASES.map((s) => {
        const story = customers.find((c) => c.useCase === s.id);
        return (
          <section key={s.id} id={s.id} style={{ borderTop: "1px solid #ececef", padding: "96px 32px", scrollMarginTop: 64 }}>
            <div style={{ margin: "0 auto", display: "flex", maxWidth: 1180, flexDirection: "column", gap: 48 }}>
              <div className="reveal" style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 640 }}>
                  <span style={{ fontSize: 13, color: "#737378" }}>{s.eyebrow}</span>
                  <h2 style={{ margin: 0, fontSize: "clamp(26px,2.6vw,32px)", lineHeight: 1.2, fontWeight: 500, letterSpacing: "-.03em", textWrap: "balance" }}>{s.title}</h2>
                  <p style={{ margin: 0, fontSize: 17, lineHeight: 1.55, color: "#6b6b70", textWrap: "pretty" }}>{s.body}</p>
                </div>
                <span style={{ display: "flex", gap: 16, fontSize: 14, color: "#737378" }}>
                  <span>Solutions</span>
                  <span style={{ color: "#0b0b0f" }}>{s.num}</span>
                </span>
              </div>
              <div style={{ display: "grid", gap: 48, gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,400px),1fr))", alignItems: "start" }}>
                <div className="reveal40" style={{ display: "flex", flexDirection: "column", gap: 12, border: "1px solid #ececef", borderRadius: 20, background: "#f7f7f8", padding: 24, minHeight: 320, fontSize: 13 }}>
                  <span style={{ color: "#737378" }}>{s.demoLabel}</span>
                  <div style={{ display: "flex", flex: 1, flexDirection: "column", border: "1px solid #e6e6e9", borderRadius: 12, background: "#fff", padding: "6px 18px" }}>
                    {s.demo.map(([k, v, dot]) => (
                      <span key={k} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, borderBottom: "1px solid #f1f1f3", padding: "12px 0", fontSize: 14 }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 10, color: "#3a3a3c" }}>
                          <span style={{ width: 6, height: 6, flexShrink: 0, borderRadius: "50%", background: dot }} />
                          {k}
                        </span>
                        <span style={{ color: "#0b0b0f", fontWeight: 500, textAlign: "right" }}>{v}</span>
                      </span>
                    ))}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                  {s.points.map(([t, b]) => (
                    <div key={t} style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: "1px solid #ececef", paddingTop: 18 }}>
                      <h3 style={{ margin: 0, fontSize: 18, fontWeight: 500, letterSpacing: "-.015em" }}>{t}</h3>
                      <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: "#6b6b70", textWrap: "pretty" }}>{b}</p>
                    </div>
                  ))}
                  {story ? (
                    <a href={`/customers/${story.slug}/`} className="card-hover" style={moreCard}>
                      <span style={{ fontSize: 15, lineHeight: 1.5, textWrap: "pretty" }}>“{story.quote}”</span>
                      <span style={{ fontSize: 13, color: "#6b6b70" }}>
                        {story.name}, {story.org} · <span style={underline}>Read case study</span>
                      </span>
                    </a>
                  ) : (
                    <a href={s.more.href} className="card-hover" style={moreCard}>
                      <span style={{ fontSize: 15, lineHeight: 1.5, textWrap: "pretty" }}>{s.more.text}</span>
                      <span style={{ fontSize: 13, color: "#6b6b70" }}>
                        <span style={underline}>{s.more.label}</span>
                      </span>
                    </a>
                  )}
                </div>
              </div>
            </div>
          </section>
        );
      })}

      <CtaRow title="Your recording, your server. Start today.">
        <DarkBtn href="/self-hosting/">Self-host Tapry</DarkBtn>
        <OutlineBtn href="/pricing/">See pricing</OutlineBtn>
      </CtaRow>
    </Shell>
  );
}

const moreCard = { display: "flex", flexDirection: "column", gap: 10, border: "1px solid #ececef", borderRadius: 20, padding: 20, color: "#0b0b0f", transition: "background .3s" } as const;
const underline = { color: "#0b0b0f", textDecoration: "underline", textUnderlineOffset: 3, textDecorationColor: "#e8553d" } as const;
