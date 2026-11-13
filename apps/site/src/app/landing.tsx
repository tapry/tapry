"use client";

// The Tapry landing page, from the "Tapry Landing Tembo" design. The studio in the hero and the
// flow panels are illustrations of the real app: demo people, but only screens, labels and
// figures the app really has (dashboard-shell.tsx and room.tsx in apps/web).
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { Footer } from "@/components/footer";
import { IC, Icon, LogoMark } from "@/components/icons";
import { Nav } from "@/components/nav";
import { customers } from "@/content/customers";
import { CLOUD_NEWS, GET_STARTED, HAS_CLOUD } from "@/content/site";

const G = "#12924f";
const A = "#a16207";
const R = "#d6453d";
const B = "#e8553d";
// The demo people are drawn as the app draws anyone: initials on a colour. No photos of real people.
const Y = "#c43c25";
const T = "#3f3f46";
const N = "#a16207";

/** A person's initial on their colour: the avatar, or (`tile`) a camera-off video tile. */
function Face({ name, color, size, tile = false, mirror = false }: { name: string; color: string; size: number; tile?: boolean; mirror?: boolean }) {
  const circle = (
    <span
      aria-hidden="true"
      style={{ display: "grid", width: size, height: size, flexShrink: 0, placeItems: "center", borderRadius: "50%", background: color, color: "#fff", fontSize: Math.round(size * 0.42), fontWeight: 500, transform: mirror ? "none" : undefined }}
    >
      {name[0]}
    </span>
  );
  if (!tile) return circle;
  return <span style={{ display: "grid", width: "100%", height: "100%", placeItems: "center", background: "#27272a" }}>{circle}</span>;
}
const MONO = "var(--mono)";
const EASE = "cubic-bezier(.2,.7,.2,1)";

const pad = (n: number) => String(n).padStart(2, "0");

const FLOW: Array<[string, string]> = [
  ["Invite", "Send each guest a link, and a tech-check link to try their setup before the session."],
  ["Record", "Every browser records its own camera and mic and saves it on that computer before anything is sent."],
  ["Upload", "Pieces arrive while you talk. A dropped connection resumes where it stopped."],
  ["Files", "Per-person WAV and MP4, aligned to Record and levelled, with a transcript made on your server."],
];

// What the recordings can be kept in. It is set once per install (the S3_* settings in
// docker-compose.yml), not picked in the app.
const BUCKETS: Array<[string, string, string?]> = [
  ["SeaweedFS (bundled)", IC.disk, "default"],
  ["AWS S3", IC.cloudCheck],
  ["Backblaze B2", IC.cloudCheck],
  ["Cloudflare R2", IC.cloudCheck],
  ["Other S3-compatible", IC.cloudCheck],
];

const FORMAT_POINTS: Array<[string, string]> = [
  ["Set formats per studio.", "WAV or FLAC audio; 1080p, 720p or audio only. Change it in the studio’s settings, nothing else moves."],
  ["Bring your own bucket.", "The bundled SeaweedFS, or an S3-compatible bucket such as AWS S3, Cloudflare R2 or Backblaze B2 that accepts signed uploads. You choose when you install."],
  ["Files your editor opens.", "One WAV and one MP4 per person, all the same length from Record, plus the combined video and the transcript as TXT, DOCX, SRT and VTT."],
];

const WORKS_WITH = ["Chrome", "Firefox", "Safari"];

// Demo people: [name, colour, role, saved so far, upload behind, talk share]. The sizes are what
// 42 minutes at 1080p comes to (about 3–4 GB per person and hour, docs/costs.md).
const PEOPLE: Array<[string, string, string, string, boolean, number]> = [
  ["Yasmine", Y, "host", "2.6 GB", false, 46],
  ["Tom", T, "", "2.4 GB", false, 31],
  ["Ines", N, "", "2.2 GB", true, 23],
];

/** True when the visitor asked for less motion: the illustrations then stand still. */
function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(m.matches);
    update();
    m.addEventListener("change", update);
    return () => m.removeEventListener("change", update);
  }, []);
  return reduced;
}

export function Landing() {
  const stories = customers.slice(0, 2);

  return (
    <div className="landing" data-screen-label="Home" style={{ minHeight: "100vh", background: "#fff", overflowX: "clip" }}>
      <a href="#main" className="skip">
        Skip to content
      </a>
      <Nav overlay />

      <main id="main">
        {/* Hero */}
        <section id="top" className="on-brand" style={{ position: "relative", padding: "150px 28px 0", overflow: "hidden", background: "linear-gradient(180deg,#7d2613 0%,#a83a1e 34%,#c9552f 60%,#f3b9a0 82%,#fff 100%)" }}>
          <div aria-hidden="true" style={{ position: "absolute", left: "-8%", top: 300, width: "46%", height: 260, borderRadius: "50%", background: "rgba(255,255,255,.28)", filter: "blur(60px)", animation: "drift 26s ease-in-out infinite" }} />
          <div aria-hidden="true" style={{ position: "absolute", right: "-10%", top: 240, width: "44%", height: 300, borderRadius: "50%", background: "rgba(255,255,255,.3)", filter: "blur(70px)", animation: "drift 34s ease-in-out infinite reverse" }} />
          <div style={{ position: "relative", margin: "0 auto", display: "flex", maxWidth: 1180, flexDirection: "column", color: "#fff" }}>
            <h1 className="rise" style={{ margin: 0, maxWidth: 720, fontSize: "clamp(44px,5.6vw,68px)", lineHeight: 1.04, fontWeight: 500, letterSpacing: "-.04em", textWrap: "balance" }}>
              Record any guest in studio quality.
            </h1>
            <div className="rise" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "24px 40px", marginTop: 34, animationDelay: ".08s" }}>
              <p style={{ margin: 0, maxWidth: 600, fontSize: 18, lineHeight: 1.55, color: "rgba(255,255,255,.92)", textWrap: "pretty" }}>
                Every guest is recorded on their own computer and uploaded while you talk. A bad connection blurs the call, never the recording. Open source, on your server.
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: 26, fontSize: 16, fontWeight: 500 }}>
                <a href={GET_STARTED} className="btn-white" style={{ display: "inline-flex", height: 44, alignItems: "center", borderRadius: 12, background: "#fff", padding: "0 20px", color: "#0b0b0f", transition: "transform .2s" }}>
                  Get Started
                </a>
                <a href="/self-hosting/" className="link-white" style={{ color: "#fff" }}>
                  Self-host it
                </a>
              </div>
            </div>
            <div className="rise" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 26px", marginTop: 38, fontSize: 15, color: "#fff", animationDelay: ".16s" }}>
              <span style={{ borderRight: "1px solid rgba(255,255,255,.4)", paddingRight: 18 }}>Works in desktop</span>
              {WORKS_WITH.map((name) => (
                <span key={name} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Icon d={IC.globe} />
                  {name}
                </span>
              ))}
              <a href="/docs/browsers/" className="link-white" style={{ color: "#fff", textDecoration: "underline", textUnderlineOffset: 3 }}>
                What’s tested
              </a>
            </div>

            <HeroStudio />
          </div>
        </section>

        <Flow />

        {/* Storage and formats */}
        <section id="formats" style={{ padding: "110px 28px", scrollMarginTop: 64 }}>
          <div style={{ margin: "0 auto", display: "grid", maxWidth: 1180, gap: 56, gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,380px),1fr))", alignItems: "center" }}>
            <div className="reveal" style={{ display: "flex", flexDirection: "column" }}>
              <h2 style={h2}>
                Choose your storage.
                <br />
                Keep your workflow.
              </h2>
              <p style={{ margin: "26px 0 56px", maxWidth: 460, fontSize: 17, lineHeight: 1.55, color: "#3d4048", textWrap: "pretty" }}>
                Keep recordings in the bundled storage or your own bucket, pick formats and quality per studio, and open the files in the editor you already use.
              </p>
              {FORMAT_POINTS.map(([title, body]) => (
                <p key={title} style={{ margin: 0, borderTop: "1px solid #e3e4e8", padding: "24px 0", fontSize: 16, lineHeight: 1.55, color: "#5f6470", textWrap: "pretty" }}>
                  <span style={{ fontWeight: 500, color: "#0b0b0f" }}>{title}</span> {body}
                </p>
              ))}
            </div>
            <div className="reveal40" style={{ borderRadius: 24, minWidth: 0 }}>
              <div style={{ position: "relative", display: "flex", minHeight: 520, flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, overflow: "hidden", borderRadius: 21, background: "linear-gradient(215deg,#faf6f3 0%,#f5e6de 50%,#e3a892 100%)", padding: 28 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 10, borderRadius: 999, background: "rgba(255,255,255,.7)", padding: "8px 16px", fontSize: 15, backdropFilter: "blur(8px)" }}>
                  <Icon d={IC.disk} />
                  Chosen when you install
                </span>
                <div style={{ display: "flex", width: "100%", maxWidth: 300, flexDirection: "column", borderRadius: 16, background: "rgba(255,255,255,.9)", padding: 6, fontSize: 15, boxShadow: "0 30px 60px -30px rgba(110,50,30,.45)", backdropFilter: "blur(10px)" }}>
                  <span style={{ borderBottom: "1px solid #e9eaee", padding: "10px 12px 12px", fontSize: 13.5, color: "#5f6470" }}>One block in docker-compose.yml</span>
                  <ul aria-label="Storage Tapry can keep recordings in" style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column" }}>
                    {BUCKETS.map(([name, icon, note]) => (
                      <li key={name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, borderRadius: 10, padding: "9px 12px", background: note ? "#fff" : "transparent", boxShadow: note ? "0 2px 8px -2px rgba(110,50,30,.25)" : "none", color: note ? "#0b0b0f" : "#4b4f59" }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <Icon d={icon} />
                          {name}
                        </span>
                        {note && <span style={{ color: "#5f6470", fontSize: 12 }}>{note}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Customer stories: only once there are real ones (src/content/customers.ts). */}
        {stories.length > 0 && (
          <section id="customers" style={{ padding: "110px 28px" }}>
            <div style={{ margin: "0 auto", display: "flex", maxWidth: 1180, flexDirection: "column", alignItems: "center", gap: 56 }}>
              <h2 className="reveal" style={{ ...h2, maxWidth: 440, textAlign: "center", lineHeight: 1.2 }}>
                How people record with Tapry
              </h2>
              <div style={{ display: "grid", width: "100%", gap: 16, gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,400px),1fr))" }}>
                {stories.map((q) => (
                  <div key={q.slug} className="reveal40" style={{ display: "flex", flexDirection: "column", gap: 20, borderRadius: 22, background: "#f5f6f8", padding: 32 }}>
                    <span style={{ fontSize: 21, fontWeight: 600, letterSpacing: "-.02em", color: "#5f6470" }}>{q.org}</span>
                    <span style={{ minHeight: 150, paddingTop: 20, fontSize: 19, lineHeight: 1.35, letterSpacing: "-.01em", textWrap: "pretty" }}>“{q.quote}”</span>
                    <span style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, borderTop: "1px solid #e3e4e8", paddingTop: 24 }}>
                      {q.stats.map(([v, k]) => (
                        <span key={k} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          <span style={{ fontSize: 19, color: "#3d4048" }}>{v}</span>
                          <span style={{ fontSize: 14, lineHeight: 1.45, color: "#5f6470" }}>{k}</span>
                        </span>
                      ))}
                    </span>
                    <a href={`/customers/${q.slug}/`} style={{ fontSize: 14, fontWeight: 500, color: "#c43c25" }}>
                      Read story &nbsp;›
                    </a>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Closing call to action, flowing into the footer */}
        <section id="start" className="on-brand" style={{ position: "relative", overflow: "hidden", padding: "230px 28px 150px", textAlign: "center", background: "linear-gradient(180deg,#fff 0%,#f3b9a0 10%,#d2603c 24%,#b8431f 38%,#a83a1e 60%,#a83a1e 100%)" }}>
          <div aria-hidden="true" style={{ position: "absolute", left: "10%", top: 120, width: "40%", height: 220, borderRadius: "50%", background: "rgba(255,255,255,.3)", filter: "blur(60px)", animation: "drift 30s ease-in-out infinite" }} />
          <div className="reveal" style={{ position: "relative", margin: "0 auto", display: "flex", maxWidth: 640, flexDirection: "column", alignItems: "center", gap: 22, color: "#fff" }}>
            <h2 style={{ margin: 0, fontSize: "clamp(34px,4.4vw,56px)", lineHeight: 1.06, fontWeight: 500, letterSpacing: "-.04em", textWrap: "balance" }}>Put your next recording in motion.</h2>
            <p style={{ margin: 0, maxWidth: 500, fontSize: 17, lineHeight: 1.55, color: "rgba(255,255,255,.94)", textWrap: "pretty" }}>
              {HAS_CLOUD
                ? "Start with an interview, a podcast or a research study. Create a free account on Tapry Cloud, or host Tapry yourself."
                : `Start with an interview, a podcast or a research study. Host Tapry yourself today. Tapry Cloud is planned: to hear when it opens, ${CLOUD_NEWS}.`}
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 26, fontSize: 16, fontWeight: 500, marginTop: 6 }}>
              <a href={GET_STARTED} className="btn-white-flat" style={{ display: "inline-flex", height: 44, alignItems: "center", borderRadius: 12, background: "#fff", padding: "0 20px", color: "#0b0b0f" }}>
                Get Started
              </a>
              <a href="/self-hosting/" className="link-white" style={{ color: "#fff" }}>
                Self-host it
              </a>
            </div>
          </div>
        </section>
      </main>

      <Footer landing />
    </div>
  );
}

/** "Nothing lost": the four steps, each opening its description and its panel. */
function Flow() {
  const [flow, setFlow] = useState(0);
  const paused = useRef(false);
  const reduced = useReducedMotion();
  const base = useId();

  // Moves on by itself every six seconds until someone picks a step; never for visitors who
  // asked for less motion.
  useEffect(() => {
    if (reduced) return;
    const id = setInterval(() => {
      if (!paused.current) setFlow((f) => (f + 1) % 4);
    }, 6000);
    return () => clearInterval(id);
  }, [reduced]);

  const row = (icon: string, color: string, k: string, v: string) => ({ icon, color, k, v });
  const panels = [
    { eyebrow: "Tech check · Priya S.", rows: [row(IC.cam, G, "Camera", "1080p"), row(IC.mic, G, "Microphone", "MacBook Pro Microphone"), row(IC.headphones, G, "Headphones", "On"), row(IC.signal, A, "Upload", "3.2 Mbit/s · finishes after"), row(IC.disk, G, "Free space", "38 GB")] },
    { eyebrow: "Recording on Ines’s laptop", rows: [row(IC.check, G, "Piece 631", "saved here"), row(IC.check, G, "Piece 632", "saved here"), row(IC.check, G, "Piece 633", "saved here"), row(IC.rec, R, "Piece 634", "recording")] },
    { eyebrow: "Uploads · The Long Table, Recording 42", rows: [row(IC.cloudCheck, G, "Yasmine", "2.6 GB · up to date"), row(IC.cloudCheck, G, "Tom", "2.4 GB · up to date"), row(IC.cloudUp, A, "Ines", "2.2 GB · 2 min behind")] },
    { eyebrow: "Files · Recording 42", rows: [row(IC.wave, G, "Ines - audio.wav", "48 kHz · −16 LUFS"), row(IC.cam, G, "Ines - video.mp4", "1080p · aligned"), row(IC.cam, A, "Combined.mp4", "rendering"), row(IC.check, G, "Transcript.srt", "ready")] },
  ];

  return (
    <section id="capture" style={{ padding: "150px 28px 110px", scrollMarginTop: 64 }}>
      <div style={{ margin: "0 auto", display: "flex", maxWidth: 1180, flexDirection: "column", gap: 64 }}>
        <h2 className="reveal" style={h2}>
          Nothing lost when
          <br />
          the internet drops.
        </h2>
        <div style={{ display: "grid", gap: 40, gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,340px),1fr))", alignItems: "center" }}>
          <div style={{ order: 2, display: "flex", flexDirection: "column", borderLeft: "2px solid #eceef1" }}>
            {FLOW.map(([title, body], i) => {
              const on = flow === i;
              return (
                <div key={title} style={{ padding: "14px 0 14px 24px", marginLeft: -2, borderLeft: `2px solid ${on ? B : "transparent"}`, transition: "border-color .3s" }}>
                  <h3 style={{ margin: 0, fontSize: 17, fontWeight: 400 }}>
                    <button
                      type="button"
                      id={`${base}-s${i}`}
                      className="fold-btn"
                      aria-expanded={on}
                      aria-controls={`${base}-d${i}`}
                      onClick={() => {
                        paused.current = true;
                        setFlow(i);
                      }}
                      style={{ justifyContent: "flex-start", alignItems: "baseline", gap: 14, transition: "color .3s", color: on ? "#0b0b0f" : "#6f7380" }}
                    >
                      <span style={{ fontFamily: MONO, fontSize: 12 }}>0{i + 1}</span>
                      {title}
                    </button>
                  </h3>
                  <div id={`${base}-d${i}`} role="region" aria-labelledby={`${base}-s${i}`} className="fold" data-open={on ? "" : undefined}>
                    <div>
                      <p style={{ margin: 0, maxWidth: 340, paddingTop: 10, fontSize: 15, lineHeight: 1.55, color: "#5f6470", textWrap: "pretty" }}>{body}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ borderRadius: 24, minWidth: 0 }}>
            {/* An illustration of each step; the words are in the step's description. */}
            <div aria-hidden="true" style={{ position: "relative", height: 440, overflow: "hidden", borderRadius: 21, background: "linear-gradient(135deg,#fbf5f2 0%,#f6e3da 45%,#e0a48c 100%)" }}>
              <div style={{ display: "flex", width: "400%", height: "100%", transition: `transform .7s ${EASE}`, transform: `translateX(-${flow * 25}%)` }}>
                {panels.map((p) => (
                  <div key={p.eyebrow} style={{ width: "25%", display: "flex", flexDirection: "column", justifyContent: "center", padding: 32 }}>
                    <div style={{ display: "flex", flexDirection: "column", borderRadius: 16, background: "rgba(255,255,255,.86)", backdropFilter: "blur(8px)", padding: "22px 24px", fontSize: 14, boxShadow: "0 20px 50px -30px rgba(110,50,30,.5)" }}>
                      <span style={{ paddingBottom: 12, fontSize: 13, color: "#5f6470" }}>{p.eyebrow}</span>
                      {p.rows.map((r) => (
                        <span key={r.k} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, borderTop: "1px solid #e9eaee", padding: "11px 0" }}>
                          <span style={{ display: "flex", minWidth: 0, alignItems: "center", gap: 10 }}>
                            <Icon d={r.icon} size={17} stroke={r.color} />
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.k}</span>
                          </span>
                          <span style={{ color: "#5f6470", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{r.v}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * The hero's studio: an illustration of a host's screen mid-recording. Its clock and who's
 * speaking tick here, not in the page, and stand still for visitors who asked for less motion.
 */
function HeroStudio() {
  const [secs, setSecs] = useState(2537);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) return;
    const id = setInterval(() => setSecs((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, [reduced]);
  const clock = `${pad(Math.floor(secs / 60))}:${pad(secs % 60)}`;
  const sp = Math.floor((secs - 2537) / 4) % 3;

  // The app's sidebar: these three links, then the studios with their recordings and space used.
  const sideNav: Array<[string, string]> = [
    ["New studio", IC.plus],
    ["Server health", IC.activity],
    ["Upload-speed check", IC.gauge],
  ];
  // [name, what's under it, space used, recording now]
  const studios: Array<[string, string, string, boolean?]> = [
    ["The Long Table", "Recording", "96.4 GB", true],
    ["Fieldnotes", "12 recordings", "31.0 GB"],
    ["Board interviews", "3 recordings · Audio only", "0.4 GB"],
  ];
  const stats: Array<[string, string]> = [
    ["People", "3 of 3 in the call"],
    ["Uploads", "2 of 3 up to date"],
    ["Saved so far", "7.2 GB"],
  ];
  const eqAnim = (on: boolean, k: number) =>
    on
      ? `eq ${(0.5 + ((k * 37) % 10) / 20).toFixed(2)}s ease-in-out ${(-k * 0.07).toFixed(2)}s infinite`
      : `eqlow ${(1.5 + ((k * 29) % 10) / 10).toFixed(2)}s ease-in-out ${(-k * 0.11).toFixed(2)}s infinite`;

  return (
    <div className="rise9" style={{ marginTop: 56, borderRadius: "26px 26px 0 0", background: "rgba(255,255,255,.34)", padding: "8px 8px 0", backdropFilter: "blur(8px)", animationDelay: ".24s" }}>
      <div
        className="hero-app"
        role="img"
        aria-label="Illustration: the Tapry studio while recording three people, with each person’s upload and share of the talking"
        style={{ display: "grid", height: 620, overflow: "hidden", borderRadius: "19px 19px 0 0", background: "#fafafa", color: "#18181b", textAlign: "left", fontSize: 13, maskImage: "linear-gradient(#000 72%,transparent 99%)", WebkitMaskImage: "linear-gradient(#000 72%,transparent 99%)" }}
      >
        {/* Left: the sidebar, with the studios */}
        <div className="hero-side" style={{ display: "flex", minWidth: 0, flexDirection: "column", gap: 2, borderRight: "1px solid #e4e4e7", padding: "14px 12px", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "2px 4px 12px" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 500 }}>
              <LogoMark size={22} />
              Tapry
            </span>
            <span style={{ display: "grid", width: 26, height: 26, placeItems: "center", border: "1px solid #e4e4e7", borderRadius: 6, background: "#fff", color: "#71717a" }}>
              <Icon d={IC.plus} size={14} />
            </span>
          </div>
          {sideNav.map(([label, d]) => (
            <span key={label} style={{ display: "flex", alignItems: "center", gap: 10, borderRadius: 6, padding: "7px 8px", fontSize: 13.5, whiteSpace: "nowrap", color: "#3f3f46" }}>
              <Icon d={d} size={15} stroke="#71717a" />
              {label}
            </span>
          ))}
          <span style={{ display: "flex", justifyContent: "space-between", padding: "16px 8px 6px", fontSize: 12.5, color: "#71717a" }}>
            <span>Studios</span>
            <span style={{ fontFamily: MONO, fontSize: 11 }}>127.8 GB</span>
          </span>
          {studios.map(([name, under, size, live]) => (
            <span key={name} style={{ display: "grid", gridTemplateColumns: "16px minmax(0,1fr) auto", alignItems: "center", columnGap: 8, rowGap: 3, borderRadius: 6, padding: "7px 8px", background: live ? "#f4f4f5" : "transparent" }}>
              <Icon d={live ? IC.rec : IC.home} size={14} stroke={live ? "#c43c25" : "#71717a"} style={{ animation: live ? "blink 1.2s infinite" : "none" }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13.5 }}>{name}</span>
              <span style={{ fontFamily: MONO, fontSize: 11, whiteSpace: "nowrap", color: live ? "#c43c25" : "#71717a" }}>{size}</span>
              <span />
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", fontSize: 12, whiteSpace: "nowrap", color: live ? "#c43c25" : "#71717a" }}>{under}</span>
            </span>
          ))}
          <span style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 9, borderTop: "1px solid #e4e4e7", padding: "12px 8px 90px", whiteSpace: "nowrap" }}>
            <Face name="Yasmine" color={Y} size={24} />
            <span style={{ display: "flex", minWidth: 0, flexDirection: "column" }}>
              <span style={{ fontSize: 13.5 }}>Yasmine</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", fontSize: 12, color: "#71717a" }}>Admin · yasmine@example.com</span>
            </span>
          </span>
        </div>

        {/* Middle: the call and the recording */}
        <div style={{ display: "flex", minWidth: 0, flexDirection: "column" }}>
          <div style={{ display: "flex", height: 50, flexShrink: 0, alignItems: "center", justifyContent: "space-between", gap: 12, borderBottom: "1px solid #e4e4e7", padding: "0 20px" }}>
            <span style={{ display: "flex", minWidth: 0, alignItems: "center", gap: 10, fontSize: 14.5, fontWeight: 600 }}>
              <span style={{ width: 8, height: 8, flexShrink: 0, borderRadius: "50%", background: B, animation: "blink 1.2s infinite" }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>The Long Table · Recording 42</span>
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: MONO, fontSize: 12, color: "#c43c25", whiteSpace: "nowrap" }}>
              <span>REC {clock}</span>
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "16px 20px" }}>
            <div style={{ borderRadius: 12, background: "#18181b", padding: 10 }}>
              <div style={{ display: "grid", gap: 6, gridTemplateColumns: "repeat(3,minmax(0,1fr))" }}>
                {PEOPLE.map(([name, photo], i) => (
                  <div key={name} style={{ position: "relative", aspectRatio: "4/3", overflow: "hidden", borderRadius: 8, background: "#27272a", transition: "outline-color .4s", outline: `2px solid ${sp === i ? "#ff8f78" : "transparent"}`, outlineOffset: -2 }}>
                    <Face name={name} color={photo} size={34} tile />
                    <span style={{ position: "absolute", left: 7, bottom: 7, borderRadius: 5, background: "rgba(0,0,0,.6)", padding: "2px 7px", fontSize: 11.5, color: "#fff" }}>{i === 0 ? "You" : name}</span>
                    {i === 2 && (
                      <span style={{ position: "absolute", right: 7, top: 7, display: "flex", alignItems: "center", gap: 4, borderRadius: 5, background: "rgba(255,255,255,.94)", padding: "2px 6px", fontSize: 11, whiteSpace: "nowrap", color: "#b45309" }}>
                        <Icon d={IC.cloudUp} size={11} />2 min behind
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 2px 0", color: "#fff" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Rings size={30} dur="2s" gap=".66s" />
                  <span style={{ fontSize: 13, fontWeight: 500 }}>Stop recording</span>
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  {[IC.mic, IC.cam].map((d) => (
                    <span key={d} style={{ display: "grid", width: 30, height: 30, placeItems: "center", borderRadius: "50%", background: "rgba(255,255,255,.12)" }}>
                      <Icon d={d} size={14} />
                    </span>
                  ))}
                  <span style={{ display: "inline-flex", height: 30, alignItems: "center", gap: 6, borderRadius: 6, background: "rgba(255,255,255,.12)", padding: "0 10px", fontSize: 12.5, fontWeight: 500 }}>
                    <Icon d={IC.link} size={13} />
                    Invite
                  </span>
                  <span style={{ display: "inline-flex", height: 30, alignItems: "center", borderRadius: 6, background: "#fff", padding: "0 10px", fontSize: 12.5, fontWeight: 500, color: "#18181b" }}>Leave</span>
                </span>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", border: "1px solid #e4e4e7", borderRadius: 12, background: "#fff" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, padding: "12px 16px", background: "linear-gradient(180deg,#fdf3ef,#fff)" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <span style={{ position: "relative", display: "grid", width: 42, height: 42, placeItems: "center" }}>
                    <span style={{ ...ringStyle, animation: `ring2 2.4s ${EASE} infinite` }} />
                    <span style={{ ...ringStyle, animation: `ring2 2.4s ${EASE} .8s infinite` }} />
                    <span style={{ position: "relative", display: "grid", width: 42, height: 42, placeItems: "center", borderRadius: "50%", background: "radial-gradient(circle at 35% 30%,#f47a5f,#e8553d 55%,#c43c25)", boxShadow: "0 0 0 4px #fff,0 0 0 5px #fbd5cc" }}>
                      <span style={{ width: 13, height: 13, borderRadius: 3, background: "#fff" }} />
                    </span>
                  </span>
                  <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 5, borderRadius: 6, background: "#fef2f2", padding: "1px 7px", fontSize: 11.5, fontWeight: 600, color: "#c43c25" }}>
                        <span style={{ width: 5, height: 5, borderRadius: "50%", background: "currentColor", animation: "blink 1.2s infinite" }} />
                        Recording
                      </span>
                      <span style={{ display: "flex", height: 14, alignItems: "center", gap: 2 }}>
                        {[0.9, 0.7, 1.1, 0.6, 0.95, 0.75, 1.05, 0.65, 0.85].map((d, k) => (
                          <span key={k} style={{ width: 2.5, height: 14, borderRadius: 2, background: "#c43c25", transform: "scaleY(.25)", animation: `eq ${d}s ease-in-out ${-k * 0.13}s infinite` }} />
                        ))}
                      </span>
                    </span>
                    <span style={{ fontSize: 24, lineHeight: 1.1, fontWeight: 500, letterSpacing: "-.03em", fontVariantNumeric: "tabular-nums" }}>{clock}</span>
                  </span>
                </span>
                <span className="hero-stats" style={{ display: "flex" }}>
                  {stats.map(([k, v]) => (
                    <Stat key={k} k={k} v={v} />
                  ))}
                </span>
              </div>
              {PEOPLE.map(([name, photo, , saved, behind], i) => {
                const on = sp === i;
                return (
                  <div key={name} style={{ display: "grid", gridTemplateColumns: "30px 82px minmax(30px,1fr) 96px", alignItems: "center", gap: 10, borderTop: "1px solid #f4f4f5", padding: "9px 16px" }}>
                    <span style={{ position: "relative", display: "grid", width: 30, height: 30, placeItems: "center" }}>
                      {on && (
                        <>
                          <span style={{ ...ringStyle, animation: `ring2 1.8s ${EASE} infinite` }} />
                          <span style={{ ...ringStyle, animation: `ring2 1.8s ${EASE} .6s infinite` }} />
                        </>
                      )}
                      <span style={{ position: "relative", display: "flex", borderRadius: "50%", boxShadow: `0 0 0 2px ${on ? B : "#fff"}` }}>
                        <Face name={name} color={photo} size={30} />
                      </span>
                      <span style={{ position: "absolute", right: -4, bottom: -4, display: "grid", width: 15, height: 15, placeItems: "center", borderRadius: "50%", border: "2px solid #fff", color: "#fff", background: on ? B : "#a1a1aa" }}>
                        <Icon d={IC.mic} size={8} width={2.8} />
                      </span>
                    </span>
                    <span style={{ display: "flex", minWidth: 0, flexDirection: "column" }}>
                      <span style={{ fontSize: 13.5, fontWeight: 500, whiteSpace: "nowrap" }}>{name}</span>
                      <span style={{ fontSize: 11.5, color: "#71717a", whiteSpace: "nowrap" }}>{saved} saved</span>
                    </span>
                    <span style={{ display: "flex", minWidth: 0, height: 28, alignItems: "center", gap: 8, borderRadius: 999, padding: "0 10px", transition: "background .3s", background: on ? "#fef2f2" : "#f4f4f5" }}>
                      <span style={{ display: "flex", minWidth: 0, flex: 1, height: 16, alignItems: "center", justifyContent: "space-between", gap: 2, overflow: "hidden" }}>
                        {Array.from({ length: 18 }, (_, k) => (
                          <span key={k} style={{ flex: "1 1 0", minWidth: 2, maxWidth: 3, height: 16, borderRadius: 2, transform: "scaleY(.3)", background: on ? B : "#a1a1aa", animation: eqAnim(on, k) }} />
                        ))}
                      </span>
                      <span style={{ fontSize: 11.5, fontWeight: 500, whiteSpace: "nowrap", color: on ? "#c43c25" : "#71717a" }}>{on ? "Speaking" : "Listening"}</span>
                    </span>
                    <span style={{ justifySelf: "end", display: "flex", alignItems: "center", gap: 5, borderRadius: 6, padding: "2px 7px 2px 5px", fontSize: 11.5, fontWeight: 500, whiteSpace: "nowrap", background: behind ? "#fffbeb" : "#f0fdf4", color: behind ? "#b45309" : "#15803d" }}>
                      <Icon d={behind ? IC.cloudUp : IC.cloudCheck} size={12} />
                      {behind ? "2 min behind" : "Saved"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right: who's in the studio, with each person's alerts and share of the talking */}
        <div className="hero-right" style={{ display: "flex", minWidth: 0, flexDirection: "column", gap: 12, borderLeft: "1px solid #e4e4e7", padding: "14px 14px", overflow: "hidden" }}>
          <span style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 500 }}>
            In the studio · 3<span style={{ fontWeight: 400, color: "#c43c25" }}>+ Invite</span>
          </span>
          {PEOPLE.map(([name, photo, role, , behind, share]) => (
            <div key={name} style={{ display: "flex", gap: 9, border: "1px solid #e4e4e7", borderRadius: 10, background: "#fff", padding: "9px 10px" }}>
              <Face name={name} color={photo} size={28} />
              <span style={{ display: "flex", minWidth: 0, flex: 1, flexDirection: "column", gap: 4 }}>
                <span style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
                  <span style={{ fontWeight: 500, whiteSpace: "nowrap" }}>
                    {name} <span style={{ fontWeight: 400, color: "#71717a" }}>{role}</span>
                  </span>
                  <span style={{ fontSize: 11.5, color: "#71717a", whiteSpace: "nowrap" }}>{share}% talking</span>
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: behind ? "#b45309" : "#15803d" }}>
                  <Icon d={behind ? IC.cloudUp : IC.cloudCheck} size={13} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{behind ? "Recording · upload behind" : "Recording · up to date"}</span>
                </span>
                {behind && (
                  <span style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    <span style={{ borderRadius: 5, background: "#fffbeb", padding: "1px 6px", fontSize: 11, color: "#b45309" }}>2 min behind</span>
                    <span style={{ borderRadius: 5, background: "#f4f4f5", padding: "1px 6px", fontSize: 11, color: "#52525b" }}>No headphones</span>
                  </span>
                )}
              </span>
            </div>
          ))}
          <span style={{ display: "flex", height: 32, alignItems: "center", justifyContent: "center", border: "1px solid #e4e4e7", borderRadius: 8, background: "#fff", fontSize: 12.5, fontWeight: 500, color: "#c43c25" }}>End session for everyone</span>
        </div>
      </div>
    </div>
  );
}

function Rings({ size, dur, gap }: { size: number; dur: string; gap: string }) {
  return (
    <span style={{ position: "relative", display: "grid", width: size, height: size, placeItems: "center" }}>
      <span style={{ ...ringStyle, animation: `ring2 ${dur} ease-out infinite` }} />
      <span style={{ ...ringStyle, animation: `ring2 ${dur} ease-out ${gap} infinite` }} />
      <span style={{ position: "relative", display: "grid", width: size, height: size, placeItems: "center", borderRadius: "50%", background: B }}>
        <span style={{ width: 10, height: 10, borderRadius: 2, background: "#fff" }} />
      </span>
    </span>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <span style={{ display: "flex", flexDirection: "column", gap: 2, borderLeft: "1px solid #e4e4e7", padding: "0 14px" }}>
      <span style={{ fontSize: 11.5, color: "#71717a", whiteSpace: "nowrap" }}>{k}</span>
      <span style={{ fontSize: 13.5, fontWeight: 500, whiteSpace: "nowrap" }}>{v}</span>
    </span>
  );
}

const ringStyle: CSSProperties = { position: "absolute", inset: 0, borderRadius: "50%", border: `2px solid ${B}` };
const h2: CSSProperties = { margin: 0, fontSize: "clamp(30px,3.4vw,40px)", lineHeight: 1.12, fontWeight: 500, letterSpacing: "-.035em" };
