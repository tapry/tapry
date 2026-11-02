"use client";

// The Tapry landing page, from the "Tapry Landing v9" design. Everything on it describes
// what the open-source app does today; the hosted cloud is labelled "coming soon".
import { useEffect, useState, type CSSProperties, type FormEvent } from "react";

const GITHUB = process.env.NEXT_PUBLIC_GITHUB_URL ?? "https://github.com/Mithrandiirr/opentake";
const SETUP_GUIDE = `${GITHUB}/blob/main/docs/self-hosting.md`;
const BROWSERS = `${GITHUB}/blob/main/docs/browser-support.md`;
/** Where the waitlist form posts (a form service that takes an `email` field). Unset: link to GitHub instead. */
const WAITLIST_URL = process.env.NEXT_PUBLIC_WAITLIST_URL;

const PHOTOS = { yasmine: "/people/yasmine.jpg", tom: "/people/tom.jpg", ines: "/people/ines.jpg" };

const ICON = {
  link: "M10 14a4 4 0 0 0 5.6 0l3 -3a4 4 0 0 0 -5.6 -5.6l-1 1M14 10a4 4 0 0 0 -5.6 0l-3 3a4 4 0 0 0 5.6 5.6l1 -1",
  check: "M4 12l5 5l11 -11",
  mic: "M9 4a3 3 0 0 1 6 0v7a3 3 0 0 1 -6 0zM5 11a7 7 0 0 0 14 0M12 18v3",
  micOff: "M3 3l18 18M9 9v2a3 3 0 0 0 5.1 2.1M15 9.3V4a3 3 0 0 0 -5.9 -.7M5 11a7 7 0 0 0 11.5 5.4M12 18v3",
  cam: "M3 7h12v10H3zM15 10l6 -3v10l-6 -3",
  camOff: "M3 3l18 18M15 10l6 -3v10l-6 -3M3 7h4M15 15v2H3V7",
  leave: "M10 17l-5 -5l5 -5M5 12h11M16 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-3",
  invite: "M9 11a4 4 0 1 0 0 -8a4 4 0 0 0 0 8M2 21a7 7 0 0 1 14 0M19 8v6M16 11h6",
  guests: "M9 11a4 4 0 1 0 0 -8a4 4 0 0 0 0 8M2 21a7 7 0 0 1 14 0M17 3.5a4 4 0 0 1 0 7.5M22 21a7 7 0 0 0 -4 -6.3",
  uploads: "M12 16V4M7 9l5 -5l5 5M4 20h16",
};

type FileKey = "transcript" | "audio" | "grid";
const PREVIEWS: Record<FileKey, { title: string; size: string; lines: Array<[string, string, string, string]> }> = {
  transcript: {
    title: "Transcript",
    size: "99 languages",
    lines: [
      ["00:00", "Yasmine", "#ff7a5f", "Welcome back to The Long Table. Today I have Tom and Ines with me."],
      ["00:09", "Tom", "#7fb4ff", "Thanks for having us. Ines just flew in from Lisbon."],
      ["00:14", "Ines", "#b9a3ff", "And the hotel Wi-Fi is terrible, so let’s see how this goes."],
      ["00:19", "Yasmine", "#ff7a5f", "Don’t worry, your recording is saved on your laptop either way."],
      ["00:26", "Tom", "#7fb4ff", "So, where do we start?"],
    ],
  },
  audio: {
    title: "Ines · audio",
    size: "340 MB",
    lines: [
      ["", "", "#a1a1a6", "Recorded on Ines’s laptop in full quality."],
      ["", "", "#a1a1a6", "Volume evened out to match everyone else."],
      ["", "", "#a1a1a6", "Lined up with the other tracks from the moment you pressed Record."],
      ["", "", "#a1a1a6", "Opens in Audacity, GarageBand, Descript, Premiere and more."],
    ],
  },
  grid: {
    title: "Side-by-side video",
    size: "1.9 GB",
    lines: [
      ["", "", "#a1a1a6", "Everyone in one frame, each with their name."],
      ["", "", "#a1a1a6", "Ready to post to YouTube or social media."],
      ["", "", "#a1a1a6", "Uses each person’s full-quality video, not the call."],
    ],
  },
};

const TREE: Array<{ kind: "folder" | "item"; label: string; depth: number; icon: string; file: FileKey | null }> = [
  { kind: "folder", label: "Episode 41", depth: 0, icon: "▾", file: null },
  { kind: "folder", label: "Audio", depth: 1, icon: "▾", file: null },
  { kind: "item", label: "Yasmine", depth: 2, icon: "∿", file: "audio" },
  { kind: "item", label: "Tom", depth: 2, icon: "∿", file: "audio" },
  { kind: "item", label: "Ines", depth: 2, icon: "∿", file: "audio" },
  { kind: "folder", label: "Video", depth: 1, icon: "▸", file: null },
  { kind: "item", label: "Side-by-side video", depth: 1, icon: "▦", file: "grid" },
  { kind: "item", label: "Transcript", depth: 1, icon: "¶", file: "transcript" },
];

// The studio's real shortcuts (⌘ on Mac, Ctrl elsewhere).
const SHORTCUTS: Array<{ label: string; keys: string[] }> = [
  { label: "Start recording", keys: ["⌘", "⇧", "R"] },
  { label: "Mute me", keys: ["⌘", "⇧", "M"] },
  { label: "Copy invite link", keys: ["⌘", "⇧", "L"] },
];

const pad = (n: number) => String(n).padStart(2, "0");
const mmss = (x: number) => `${Math.floor(x / 60)}:${pad(Math.floor(x % 60))}`;

export function Landing() {
  const [t, setT] = useState(0);
  const [clock, setClock] = useState(2537);
  const [recording, setRecording] = useState(true);
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [copied, setCopied] = useState(false);
  const [online, setOnline] = useState(true);
  const [local, setLocal] = useState(760);
  const [sent, setSent] = useState(760);
  const [file, setFile] = useState<FileKey>("transcript");
  const [shortcut, setShortcut] = useState(1);
  const [wide, setWide] = useState(true);

  useEffect(() => {
    const id = setInterval(() => setT((x) => x + 1), 250);
    const onResize = () => setWide(window.innerWidth >= 1100);
    onResize();
    window.addEventListener("resize", onResize);
    return () => {
      clearInterval(id);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  // Every tick: the clock (each second) and Ines's recording and upload.
  useEffect(() => {
    if (t === 0) return;
    if (t % 4 === 0 && recording) setClock((s) => s + 1);
    setLocal((l) => l + 0.25);
    if (online) setSent((s) => Math.min(local + 0.25, s + (s < local - 1 ? 1.2 : 0.25)));
  }, [t]); // eslint-disable-line react-hooks/exhaustive-deps

  const off = !online;
  const sentPct = local ? Math.min(100, (sent / local) * 100) : 100;
  const speaker = Math.floor(t / 16) % 3;
  const people = (
    [
      ["Yasmine (you)", PHOTOS.yasmine],
      ["Tom", PHOTOS.tom],
      ["Ines", PHOTOS.ines],
    ] as const
  ).map(([name, photo], i) => {
    const cameraOff = (i === 0 && camOff) || (i === 2 && off);
    return {
      name,
      photo,
      cameraOff,
      offline: i === 2 && off,
      ring: recording && speaker === i && !(i === 2 && off) && !(i === 0 && muted) ? "#1f9d55" : "transparent",
      dot: i === 2 && off ? "#e0a019" : i === 0 && muted ? "#e8553d" : "#1f9d55",
    };
  });
  const netState = off ? "Wi-Fi off · still recording" : sentPct < 99.5 ? "Back online · catching up" : "Connected";
  const netColor = off ? "#c43c25" : sentPct < 99.5 ? "#8a5a0c" : "#1f7a45";
  const inesText = off
    ? "Her recording is safe on her laptop. It’ll be sent automatically when she’s back online."
    : sentPct < 99.5
      ? "Sending what was saved while she was offline…"
      : "Everything recorded so far has arrived safely.";
  const preview = PREVIEWS[file];

  return (
    <div style={{ minHeight: "100vh", background: "#ffffff" }}>
      <header style={{ maxWidth: 1240, margin: "0 auto", padding: "0 28px", height: 84, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 44 }}>
          <Logo />
          <nav className="nav-links" style={{ display: "flex", gap: 32, fontSize: 16, fontWeight: 500 }}>
            <a href="#features" style={navLink}>Features</a>
            <a href="#after" style={navLink}>How it works</a>
            <a href="#pricing" style={navLink}>Pricing</a>
          </nav>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 26, fontSize: 16, fontWeight: 500 }}>
          <a href={GITHUB} className="nav-links" style={navLink}>GitHub</a>
          <a href="#pricing" className="ghost-btn" style={{ whiteSpace: "nowrap", padding: "11px 20px", borderRadius: 10, border: "1px solid #e2e2e5", color: "#1d1d1f", boxShadow: "0 1px 2px rgba(0,0,0,.05)" }}>
            Get started
          </a>
        </div>
      </header>

      {/* Hero */}
      <section style={{ padding: "84px 28px 0", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 30 }}>
        <h1 style={{ margin: 0, fontWeight: 700, fontSize: "clamp(44px,6.8vw,92px)", lineHeight: 1.02, letterSpacing: "-.04em", maxWidth: 1080, textWrap: "balance" }}>
          Podcast recording for people who’d rather be talking.
        </h1>
        <p style={{ margin: 0, fontSize: "clamp(19px,1.9vw,25px)", color: "#6e6e73", maxWidth: 760, textWrap: "pretty" }}>
          Because great conversations make great <em style={{ fontStyle: "italic", color: "#1d1d1f" }}>episodes</em>, and nobody should
          lose one to bad Wi-Fi.
        </p>
        <a href="#pricing" className="cta" style={{ display: "inline-flex", alignItems: "center", gap: 12, padding: "20px 34px", borderRadius: 14, background: "#e8553d", color: "#ffffff", fontWeight: 600, fontSize: 19, boxShadow: "0 10px 24px -10px rgba(232,85,61,.7)" }}>
          <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#ffffff", boxShadow: "0 0 0 4px rgba(255,255,255,.3)" }} />
          Start your first episode
        </a>
        <span style={{ fontSize: 14, color: "#8e8e93", marginTop: -12 }}>
          Free and open source · Works in Chrome, Safari, Edge and Firefox (<a href={BROWSERS} style={{ color: "#8e8e93", textDecoration: "underline" }}>what we test</a>)
        </span>

        {/* The studio, live */}
        <div style={{ width: "100%", maxWidth: 1180, marginTop: 40, borderRadius: "24px 24px 0 0", background: "#f6f5f3", padding: "12px 12px 0", boxShadow: "0 0 0 1px #ececef,0 -10px 50px rgba(0,0,0,.05)", textAlign: "left" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "6px 10px 14px", flexWrap: "wrap" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 12, fontWeight: 600, fontSize: 15 }}>
              The Long Table
              <span style={{ display: "flex", alignItems: "center", gap: 7, padding: "5px 11px", borderRadius: 999, background: recording ? "#fdece8" : "#e6f6ec", color: recording ? "#c43c25" : "#1f7a45", fontFamily: "var(--mono)", fontSize: 12, fontWeight: 500 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: "currentColor", animation: recording ? "otpulse 1.2s infinite" : "none" }} />
                {recording ? `REC ${Math.floor(clock / 3600)}:${pad(Math.floor(clock / 60) % 60)}:${pad(clock % 60)}` : "Stopped · finishing uploads"}
              </span>
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 16px", borderRadius: 10, background: "#2b2424", color: "#ffffff", fontSize: 14, fontWeight: 500 }}>
                <Svg d={ICON.invite} size={16} width={1.8} />
                Invite
              </span>
              <Photo src={PHOTOS.yasmine} size={34} />
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 72px", gap: 8 }}>
            <div style={{ background: "#ffffff", borderRadius: "18px 18px 0 0", boxShadow: "0 1px 3px rgba(0,0,0,.05)", display: "flex", flexDirection: "column" }}>
              <div style={{ padding: "clamp(14px,2.4vw,28px)", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,210px),1fr))", gap: 12 }}>
                {people.map((p) => (
                  <div key={p.name} style={{ position: "relative", aspectRatio: "4/3", borderRadius: 14, overflow: "hidden", background: p.cameraOff ? "#f2f1ef" : "#e9e7e4", outline: `3px solid ${p.ring}`, outlineOffset: -3, transition: "outline-color .3s" }}>
                    <div style={{ position: "absolute", inset: 0, backgroundImage: `url('${p.photo}')`, backgroundSize: "cover", backgroundPosition: "center 30%", opacity: p.cameraOff ? 0 : 1, filter: p.offline ? "grayscale(1)" : "none", transition: "opacity .3s" }} />
                    <div style={{ position: "absolute", left: "50%", top: "46%", width: "38%", aspectRatio: "1", transform: "translate(-50%,-50%)", borderRadius: "50%", backgroundImage: `url('${p.photo}')`, backgroundSize: "cover", backgroundPosition: "center 30%", opacity: p.cameraOff ? 1 : 0, transition: "opacity .3s" }} />
                    <span style={{ position: "absolute", left: 8, bottom: 8, display: "flex", alignItems: "center", gap: 7, padding: "5px 10px", borderRadius: 8, background: "rgba(30,26,26,.72)", color: "#ffffff", fontSize: 13, fontWeight: 500 }}>
                      <span style={{ width: 7, height: 7, borderRadius: "50%", background: p.dot }} />
                      {p.name}
                    </span>
                    <span style={{ position: "absolute", right: 8, top: 8, padding: "4px 10px", borderRadius: 999, background: "#ffffff", color: "#c43c25", fontSize: 12, fontWeight: 600, opacity: p.offline ? 1 : 0 }}>
                      Offline · still recording
                    </span>
                  </div>
                ))}
              </div>
              <div style={{ margin: "0 clamp(14px,2.4vw,28px)", borderTop: "1px solid #efeeec" }} />
              <div style={{ padding: "14px clamp(10px,2vw,24px) 18px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                <div style={{ display: "flex", gap: 14 }}>
                  <Tool
                    label={copied ? "Copied" : "Invite link"}
                    d={copied ? ICON.check : ICON.link}
                    onClick={() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1600);
                    }}
                  />
                </div>
                <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                  <button type="button" onClick={() => setRecording(!recording)} style={{ ...toolButton }}>
                    <span style={{ height: 42, display: "flex", alignItems: "center", gap: 9, padding: "0 16px", borderRadius: 10, background: recording ? "#2b2424" : "#e8553d", color: "#ffffff", font: "600 15px var(--sans)", whiteSpace: "nowrap" }}>
                      <span style={{ width: 14, height: 14, borderRadius: recording ? 3 : "50%", border: "2px solid #ffffff", display: "grid", placeItems: "center" }}>
                        <span style={{ width: 6, height: 6, borderRadius: recording ? 1 : "50%", background: "#ffffff" }} />
                      </span>
                      {recording ? "Stop" : "Record"}
                    </span>
                    {recording ? "Recording" : "Start"}
                  </button>
                  <Tool label={muted ? "Unmute" : "Mute"} d={muted ? ICON.micOff : ICON.mic} alert={muted} onClick={() => setMuted(!muted)} />
                  <Tool label={camOff ? "Camera on" : "Camera"} d={camOff ? ICON.camOff : ICON.cam} alert={camOff} onClick={() => setCamOff(!camOff)} />
                  <Tool label="Leave" d={ICON.leave} alert onClick={() => {}} />
                </div>
                <span style={{ width: 60 }} />
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 22, paddingTop: 24, fontSize: 12, color: "#3a3a3c" }}>
              <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
                <Svg d={ICON.guests} size={20} width={1.6} />
                Guests
              </span>
              <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
                <Svg d={ICON.uploads} size={20} width={1.6} />
                Uploads
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Light features */}
      <section id="features" style={{ borderTop: "1px solid #efeff1", padding: "120px 28px" }}>
        <div style={{ maxWidth: 1180, margin: "0 auto", display: "flex", flexDirection: "column", gap: 56 }}>
          <SectionHead eyebrow="FOR SHOWS, NOT MEETINGS" title="Built for recording, not for meetings" eyebrowColor="#e8553d">
            Video-call apps squeeze everyone down to save bandwidth. Tapry records every person in full quality, right on their own computer.
          </SectionHead>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,520px),1fr))", gap: 20 }}>
            <div style={{ background: "#f7f7f8", borderRadius: 26, padding: "clamp(24px,3.4vw,44px)", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,240px),1fr))", gap: 28, alignItems: "center" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <h3 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: "#d4472f" }}>Nothing lost when the internet drops</h3>
                <p style={{ margin: 0, fontSize: 18, lineHeight: 1.6, color: "#6e6e73" }}>
                  Each guest’s recording is saved on their own computer first. If their Wi-Fi cuts out, it keeps recording and sends the rest once they’re back.
                </p>
                <button type="button" onClick={() => setOnline(!online)} aria-pressed={!online} style={{ cursor: "pointer", marginTop: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "14px 16px", borderRadius: 14, border: 0, background: "#ffffff", boxShadow: "0 1px 3px rgba(0,0,0,.06)", font: "500 16px var(--sans)", color: "#1d1d1f", textAlign: "left" }}>
                  <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    Ines’s Wi-Fi
                    <span style={{ fontSize: 13, color: "#8e8e93", fontWeight: 400 }}>Tap to try it</span>
                  </span>
                  <span style={{ width: 52, height: 30, borderRadius: 999, background: off ? "#d1d1d6" : "#1f9d55", position: "relative", flexShrink: 0, transition: "background .2s" }}>
                    <span style={{ position: "absolute", top: 3, left: off ? 3 : 25, width: 24, height: 24, borderRadius: "50%", background: "#ffffff", boxShadow: "0 1px 3px rgba(0,0,0,.25)", transition: "left .2s" }} />
                  </span>
                </button>
              </div>
              <div style={{ borderRadius: 18, background: "linear-gradient(160deg,#ffe3d6,#f4b6a3 55%,#d98a9c)", padding: "26px 18px", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 300 }}>
                <div style={{ width: "100%", maxWidth: 290, background: "#ffffff", borderRadius: 14, boxShadow: "0 18px 40px -18px rgba(80,20,20,.5)", overflow: "hidden" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderBottom: "1px solid #f0f0f2" }}>
                    <Photo src={PHOTOS.ines} size={28} />
                    <span style={{ display: "flex", flexDirection: "column" }}>
                      <span style={{ fontSize: 14, fontWeight: 600 }}>Ines’s laptop</span>
                      <span style={{ fontSize: 12, color: netColor }}>{netState}</span>
                    </span>
                  </div>
                  <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <span style={{ fontSize: 13, color: "#8e8e93" }}>Recorded on this laptop</span>
                      <span style={{ fontSize: 20, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{mmss(local)}</span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                        <span style={{ color: "#8e8e93" }}>Received by Yasmine</span>
                        <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{mmss(sent)}</span>
                      </div>
                      <div style={{ height: 8, borderRadius: 999, background: "#f0f0f2", overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${sentPct.toFixed(1)}%`, borderRadius: 999, background: off ? "#e8553d" : "#1f9d55", transition: "width .3s" }} />
                      </div>
                    </div>
                    <span style={{ fontSize: 13, lineHeight: 1.45, color: netColor }}>{inesText}</span>
                  </div>
                </div>
              </div>
            </div>
            <div style={{ background: "#f7f7f8", borderRadius: 26, padding: "clamp(24px,3.4vw,44px)", display: "flex", flexDirection: "column", gap: 14 }}>
              <h3 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: "#d4472f" }}>Guests just click a link</h3>
              <p style={{ margin: 0, fontSize: 18, lineHeight: 1.6, color: "#6e6e73", maxWidth: 460 }}>
                There’s nothing to download and no account to make. Guests see themselves, type their name and join you.
              </p>
              <div style={{ marginTop: "auto", paddingTop: 24 }}>
                <div style={{ background: "#ffffff", borderRadius: 16, boxShadow: "0 14px 30px -18px rgba(0,0,0,.25)", padding: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,180px),1fr))", gap: 16, alignItems: "center" }}>
                  <div style={{ aspectRatio: "4/3", borderRadius: 12, backgroundImage: `url('${PHOTOS.ines}')`, backgroundSize: "cover", backgroundPosition: "center 30%" }} />
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <span style={{ fontSize: 13, color: "#8e8e93" }}>You’re joining The Long Table</span>
                    <span style={{ height: 42, display: "flex", alignItems: "center", padding: "0 14px", borderRadius: 10, border: "1px solid #e2e2e5", fontSize: 15 }}>Ines</span>
                    <Ok>Camera looks good</Ok>
                    <Ok>Headphones on</Ok>
                    <span style={{ height: 44, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 10, background: "#1d1d1f", color: "#ffffff", fontWeight: 600, fontSize: 15 }}>Join</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Dark: after you press Stop */}
      <section id="after" style={{ background: "#0b0b0d", color: "#f5f5f7", padding: "110px 28px 60px" }}>
        <div style={{ maxWidth: 1180, margin: "0 auto", display: "flex", flexDirection: "column", gap: 56 }}>
          <SectionHead eyebrow="AFTER YOU PRESS STOP" title="Your episode, ready before your coffee" eyebrowColor="#ff7a5f" dark>
            Tapry lines everyone up, evens out the volume and writes a transcript, then hands you a tidy folder.
          </SectionHead>
          <div style={{ position: "relative", borderRadius: 30, background: "#1c1c1f", overflow: "hidden", padding: "clamp(28px,5vw,72px) clamp(18px,4vw,56px)" }}>
            <div style={{ position: "absolute", left: "50%", top: "50%", width: 1300, height: 1300, transform: "translate(-50%,-50%)", borderRadius: "50%", background: "repeating-radial-gradient(circle,transparent 0 120px,rgba(255,255,255,.035) 120px 121px)" }} />
            <div style={{ position: "relative", display: "grid", gridTemplateColumns: wide ? "minmax(0,.8fr) minmax(0,1fr) minmax(0,1fr)" : "repeat(auto-fit,minmax(min(100%,300px),1fr))", gap: 28, alignItems: "center" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 14, gridColumn: wide ? "auto" : "1 / -1" }}>
                <div style={{ display: "flex", alignItems: "center" }}>
                  <span style={{ width: 64, height: 64, borderRadius: "50%", border: "2px solid #ff7a5f", display: "grid", placeItems: "center", flexShrink: 0 }}>
                    <span style={{ width: 20, height: 20, borderRadius: 4, background: "#ff7a5f" }} />
                  </span>
                  <span style={{ flex: 1, height: 2, background: "linear-gradient(90deg,#ff7a5f,rgba(255,122,95,.2))" }} />
                </div>
                <span style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-.02em" }}>You press Stop</span>
                <span style={{ fontSize: 16, color: "#a1a1a6", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ padding: "5px 10px", borderRadius: 8, border: "1px solid #3a3a3e", fontFamily: "var(--mono)", fontSize: 13, color: "#f5f5f7" }}>58 min · 3 people</span>
                  and we take it from there
                </span>
              </div>
              <Window title="Episode 41">
                <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 2, fontSize: 16 }}>
                  {TREE.map((n) => {
                    const on = n.file !== null && file === n.file && (n.file !== "audio" || n.label === "Ines");
                    return (
                      <button
                        key={n.label}
                        type="button"
                        onClick={() => n.file && setFile(n.file)}
                        style={{ cursor: n.file ? "pointer" : "default", border: 0, textAlign: "left", display: "flex", alignItems: "center", gap: 10, padding: `7px 10px 7px ${10 + n.depth * 22}px`, borderRadius: 8, background: on ? "#3a3a3e" : "transparent", color: on ? "#ffffff" : "#d1d1d6", font: `${n.kind === "folder" ? 500 : 400} 16px var(--sans)` }}
                      >
                        <span style={{ width: 18, textAlign: "center", color: n.kind === "folder" ? "#ff7a5f" : "#a1a1a6" }}>{n.icon}</span>
                        {n.label}
                      </button>
                    );
                  })}
                </div>
              </Window>
              <Window title={preview.title} aside={preview.size}>
                <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12, minHeight: 220 }}>
                  {preview.lines.map(([time, who, color, text]) => (
                    <div key={text} style={{ display: "grid", gridTemplateColumns: "52px minmax(0,1fr)", gap: 10, fontSize: 14, lineHeight: 1.5 }}>
                      <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: "#6e6e73", paddingTop: 2 }}>{time}</span>
                      <span style={{ color: "#d1d1d6" }}>
                        <span style={{ color, fontWeight: 600 }}>{who}</span> {text}
                      </span>
                    </div>
                  ))}
                </div>
              </Window>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,460px),1fr))", gap: 20 }}>
            <div style={{ borderRadius: 26, background: "#1c1c1f", overflow: "hidden", display: "flex", flexDirection: "column" }}>
              <div style={{ position: "relative", height: 280, backgroundImage: "linear-gradient(#2a2a2e 1px,transparent 1px),linear-gradient(90deg,#2a2a2e 1px,transparent 1px)", backgroundSize: "56px 56px", backgroundPosition: "center", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 24 }}>
                <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at center,transparent 30%,#1c1c1f 78%)" }} />
                <div style={{ position: "relative", display: "flex", gap: 12 }} aria-label={SHORTCUTS[shortcut]!.keys.join(" ")}>
                  {SHORTCUTS[shortcut]!.keys.map((k) => (
                    <span key={k} style={{ width: 72, height: 72, borderRadius: 14, background: "#38383c", boxShadow: "inset 0 -4px 0 #2a2a2e,0 0 0 1px #48484c", display: "grid", placeItems: "center", fontSize: 30, fontWeight: 600 }}>
                      {k}
                    </span>
                  ))}
                </div>
                <div style={{ position: "relative", display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center", padding: "0 12px" }}>
                  {SHORTCUTS.map((c, i) => (
                    <button key={c.label} type="button" onClick={() => setShortcut(i)} aria-pressed={i === shortcut} style={{ cursor: "pointer", padding: "9px 16px", borderRadius: 999, border: `1px solid ${i === shortcut ? "#5a5a5e" : "#2e2e33"}`, background: i === shortcut ? "#38383c" : "transparent", color: i === shortcut ? "#ffffff" : "#6e6e73", font: "500 15px var(--sans)", whiteSpace: "nowrap" }}>
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
              <DarkCardText title="Hands-free shortcuts">
                Start and stop recording, mute yourself or copy the invite link without reaching for the mouse. (Ctrl instead of ⌘ on Windows and Linux.)
              </DarkCardText>
            </div>
            <div style={{ borderRadius: 26, background: "#1c1c1f", overflow: "hidden", display: "flex", flexDirection: "column" }}>
              <div style={{ height: 280, display: "flex", alignItems: "center", justifyContent: "center", background: "radial-gradient(circle at 70% 20%,#2e2e33,#1c1c1f 60%)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap", justifyContent: "center", padding: "0 16px" }}>
                  {["Chrome", "Safari", "Edge", "Firefox"].map((b) => (
                    <span key={b} style={{ padding: "14px 20px", borderRadius: 14, background: "#2e2e33", boxShadow: "0 0 0 1px #3a3a3e", fontWeight: 600, fontSize: 17 }}>
                      {b}
                    </span>
                  ))}
                </div>
              </div>
              <DarkCardText title="On Mac, Windows or a Chromebook">
                Whatever computer your guests have, if it has a modern browser it works. Nobody has to install anything.
              </DarkCardText>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" style={{ background: "#0b0b0d", color: "#f5f5f7", padding: "60px 28px 120px" }}>
        <div style={{ maxWidth: 1180, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,380px),1fr))", gap: 20 }}>
          <div style={{ borderRadius: 26, background: "#f5f5f7", color: "#1d1d1f", padding: 40, display: "flex", flexDirection: "column", gap: 16 }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 13, letterSpacing: ".12em", color: "#d4472f" }}>ON YOUR OWN SERVER</span>
            <span style={{ fontSize: 60, fontWeight: 700, letterSpacing: "-.04em", lineHeight: 1 }}>Free</span>
            <p style={{ margin: 0, fontSize: 17, lineHeight: 1.6, color: "#55555a" }}>
              Unlimited episodes, hours and guests. Your recordings stay on hardware you control. You’ll need someone technical to set it up once.
            </p>
            <a href={SETUP_GUIDE} className="dark-btn" style={{ alignSelf: "flex-start", marginTop: 8, padding: "14px 24px", borderRadius: 12, background: "#1d1d1f", color: "#ffffff", fontWeight: 600 }}>
              Read the setup guide
            </a>
          </div>
          <div style={{ borderRadius: 26, background: "#e8553d", color: "#ffffff", padding: 40, display: "flex", flexDirection: "column", gap: 16 }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 13, letterSpacing: ".12em", color: "#ffe3d6" }}>TAPRY CLOUD · COMING SOON</span>
            <span style={{ fontSize: 60, fontWeight: 700, letterSpacing: "-.04em", lineHeight: 1 }}>We host it</span>
            <p style={{ margin: 0, fontSize: 17, lineHeight: 1.6, color: "#fff1eb" }}>
              No setup and nothing to maintain. Just sign in and record. Join the waitlist and we’ll let you know when it opens.
            </p>
            <Waitlist />
          </div>
        </div>
      </section>

      <footer style={{ background: "#0b0b0d", color: "#8e8e93", borderTop: "1px solid #1f1f22" }}>
        <div style={{ maxWidth: 1180, margin: "0 auto", padding: "32px 28px", display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", fontSize: 14 }}>
          <span>© 2026 Tapry · Free and open source (AGPL-3.0)</span>
          <span style={{ display: "flex", gap: 22, flexWrap: "wrap" }}>
            <a href="/mic-test" style={{ color: "#8e8e93" }}>Free mic test</a>
            {process.env.NEXT_PUBLIC_SPEED_TEST_URL && (
              <a href="/upload-speed-test" style={{ color: "#8e8e93" }}>Upload speed test</a>
            )}
            <a href={SETUP_GUIDE} style={{ color: "#8e8e93" }}>Setup guide</a>
            <a href={BROWSERS} style={{ color: "#8e8e93" }}>Tested browsers</a>
            <a href={GITHUB} style={{ color: "#8e8e93" }}>GitHub</a>
          </span>
        </div>
      </footer>
    </div>
  );
}

/** The cloud waitlist: posts the email to WAITLIST_URL, or points to GitHub when none is set up. */
function Waitlist() {
  const [state, setState] = useState<"idle" | "sending" | "joined" | "error">("idle");
  if (!WAITLIST_URL) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
        <a href={GITHUB} style={{ alignSelf: "flex-start", height: 52, display: "inline-flex", alignItems: "center", padding: "0 24px", borderRadius: 12, background: "#ffffff", color: "#c43c25", fontWeight: 600, fontSize: 16 }}>
          Watch for releases on GitHub
        </a>
        <span style={{ fontSize: 14, color: "#fff1eb" }}>The waitlist opens soon. Meanwhile, “Watch” the repository to hear when the cloud launches.</span>
      </div>
    );
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState("sending");
    try {
      const res = await fetch(WAITLIST_URL!, { method: "POST", body: new FormData(e.currentTarget), headers: { accept: "application/json" } });
      setState(res.ok ? "joined" : "error");
    } catch {
      setState("error");
    }
  }
  return (
    <form onSubmit={submit} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
      <input
        type="email"
        name="email"
        required
        placeholder="you@yourshow.com"
        aria-label="Email for the waitlist"
        disabled={state === "joined"}
        style={{ flex: 1, minWidth: 200, height: 52, padding: "0 18px", borderRadius: 12, border: 0, background: "rgba(255,255,255,.18)", color: "#ffffff", font: "400 16px var(--sans)" }}
      />
      <button type="submit" disabled={state === "sending" || state === "joined"} style={{ cursor: "pointer", height: 52, padding: "0 24px", borderRadius: 12, border: 0, background: "#ffffff", color: "#c43c25", font: "600 16px var(--sans)", whiteSpace: "nowrap" }}>
        {state === "joined" ? "✓ You're on the list" : state === "sending" ? "Joining…" : "Join the waitlist"}
      </button>
      {state === "error" && <span style={{ width: "100%", fontSize: 14, color: "#fff1eb" }}>That didn’t go through. Try again in a moment.</span>}
    </form>
  );
}

const navLink: CSSProperties = { color: "#1d1d1f", whiteSpace: "nowrap" };
const toolButton: CSSProperties = { cursor: "pointer", border: 0, background: "transparent", display: "flex", flexDirection: "column", alignItems: "center", gap: 6, font: "400 13px var(--sans)", color: "#3a3a3c" };

function Logo() {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 700, fontSize: 22, letterSpacing: "-.02em" }}>
      <span style={{ position: "relative", width: 24, height: 24 }}>
        <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "#fbd5cc", transform: "translate(4px,3px)" }} />
        <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "#e8553d" }} />
      </span>
      Tapry
    </span>
  );
}

function Svg({ d, size, width }: { d: string; size: number; width: number }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

function Photo({ src, size }: { src: string; size: number }) {
  return <span style={{ width: size, height: size, borderRadius: "50%", backgroundImage: `url('${src}')`, backgroundSize: "cover", flexShrink: 0 }} />;
}

function Tool({ label, d, alert, onClick }: { label: string; d: string; alert?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{ ...toolButton, minWidth: 52 }}>
      <span style={{ width: 42, height: 42, borderRadius: 10, background: alert ? "#fdece8" : "#f2f1ef", color: alert ? "#c43c25" : "#1d1d1f", display: "grid", placeItems: "center", transition: "background .2s" }}>
        <Svg d={d} size={20} width={1.7} />
      </span>
      {label}
    </button>
  );
}

function SectionHead({ eyebrow, title, children, eyebrowColor, dark }: { eyebrow: string; title: string; children: React.ReactNode; eyebrowColor: string; dark?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 16 }}>
      <span style={{ fontFamily: "var(--mono)", fontSize: 14, letterSpacing: ".14em", color: eyebrowColor }}>{eyebrow}</span>
      <h2 style={{ margin: 0, fontWeight: 700, fontSize: "clamp(36px,4.6vw,62px)", lineHeight: 1.04, letterSpacing: "-.035em", textWrap: "balance" }}>{title}</h2>
      <p style={{ margin: 0, fontSize: 20, lineHeight: 1.5, color: dark ? "#a1a1a6" : "#6e6e73", maxWidth: 640, textWrap: "pretty" }}>{children}</p>
    </div>
  );
}

function Window({ title, aside, children }: { title: string; aside?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "#2a2a2e", border: "1px solid #3a3a3e", borderRadius: 16, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 16px", borderBottom: "1px solid #3a3a3e" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {!aside && (
            <span style={{ display: "flex", gap: 6 }}>
              {[0, 1, 2].map((i) => (
                <span key={i} style={{ width: 10, height: 10, borderRadius: "50%", background: "#4a4a4e" }} />
              ))}
            </span>
          )}
          <span style={{ fontWeight: 600 }}>{title}</span>
        </span>
        {aside && <span style={{ fontSize: 13, color: "#a1a1a6" }}>{aside}</span>}
      </div>
      {children}
    </div>
  );
}

function DarkCardText({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: "8px 36px 36px", display: "flex", flexDirection: "column", gap: 10 }}>
      <h3 style={{ margin: 0, fontSize: 21, fontWeight: 600, color: "#ff7a5f" }}>{title}</h3>
      <p style={{ margin: 0, fontSize: 17, lineHeight: 1.6, color: "#a1a1a6" }}>{children}</p>
    </div>
  );
}

function Ok({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: "#1f7a45" }}>
      <span style={{ width: 18, height: 18, borderRadius: "50%", background: "#e6f6ec", display: "grid", placeItems: "center", fontSize: 11 }}>✓</span>
      {children}
    </span>
  );
}
