import { CtaRow, DarkBtn, H1, H2, HERO_BG, LEAD, OutlineBtn, SectionHead, Shell } from "@/components/ui";
import { BROWSERS_DOC, GET_STARTED, HAS_CLOUD, pageMeta, SETUP_GUIDE } from "@/content/site";

export const metadata = pageMeta({
  title: "Tapry compared with Riverside and other recording studios, including what it doesn't do · Tapry",
  description: "What Tapry shares with Riverside, Zencastr and Descript, where it differs (self-hosted, open source, your own storage) and what it doesn't do: no live streaming, no editor, no apps.",
  path: "/compare/",
});

// Checked against each vendor's own public pages on the date below (docs/plan/14-riverside-parity.md).
// Keep the date when a row changes, and never claim something about another product we haven't read there.
const CHECKED = "15 November 2026";

const SAME: Array<[string, string]> = [
  ["Everyone is recorded on their own device", "The recording is made in each person’s browser at full quality, not taken from the call. A weak connection blurs the live picture, never the file."],
  ["Uploads while you talk", "The recording leaves each device in small pieces during the session, and what’s left is sent when someone comes back after a drop or a crash."],
  ["A separate file per person", "Sound and video for each participant, lined up to the same start, plus one video of everyone."],
  ["Guests join from a link", "No account and nothing to install, in Chrome, Edge, Firefox or Safari."],
];

const OURS: Array<[string, string]> = [
  ["You can run it yourself", "Tapry is open source (AGPL-3.0) and installs with Docker. We found no other studio in this group that can be self-hosted."],
  ["Recordings in storage you own", "On your server, or in your own S3-compatible bucket. Elsewhere this was offered by one vendor, on request, at its top plan."],
  ["Transcripts and AI notes made on the server", "Transcripts are written on the machine that holds the recordings. AI notes use a local model by default; an outside model only if the account’s owner turns it on."],
  ["A consent record with every recording", "Each guest agrees to the studio’s exact text before joining; the recording keeps who agreed, when, and to what."],
  ["The host sees problems while recording", "Per guest: upload progress, a distorting, silent or quiet microphone, echo, an upload falling behind, low disk space."],
  ["Included, not kept for the top plan", "A solo recording link, a producer seat, an API with webhooks, timeline exports and frame-rate choice."],
  ["For research", "Sound-only studios, share-safe transcripts with names and contact details masked, and exports for NVivo, MAXQDA and ATLAS.ti."],
];

const THEIRS: Array<[string, string]> = [
  ["Live streaming, webinars and audience features", "Not built, and not planned. Riverside and StreamYard do this."],
  ["An editor", "Tapry cuts clips and exports timelines for your editor; it has no text-based or timeline editor. Riverside and Descript do."],
  ["Mobile and desktop apps", "Tapry runs in the browser only, phones included. Riverside and Zencastr have apps."],
  ["Removing filler words; live captions", "Tapry removes long pauses in exported timelines, not “um” and “uh”, and shows no captions during the session."],
  ["Intro and outro, name-and-title lower thirds, background images", "The combined video carries names and your logo; backgrounds can be blurred, not replaced."],
  ["Delivery to Google Drive or Dropbox", "Tapry offers downloads, a zip, your own bucket and webhooks."],
  ["Soundboard, a teleprompter guests see, a phone as second camera", "Not built. Hosts have a guide panel."],
  ["Single sign-on, SOC 2 or ISO 27001", "None. Self-hosting puts the data under your own controls instead; a certificate it is not."],
  ["A long track record", "Riverside has years of sessions behind it. Tapry is new: it is tested end to end, including hour-long recordings, and has had little use on real networks so far."],
];

const cell = { display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid #0b0b0f", paddingTop: 18 } as const;

function Rows({ rows }: { rows: Array<[string, string]> }) {
  return (
    <div style={{ display: "grid", gap: "36px 32px", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,300px),1fr))" }}>
      {rows.map(([t, b]) => (
        <div key={t} className="reveal" style={cell}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 500, letterSpacing: "-.015em", textWrap: "balance" }}>{t}</h3>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: "#6b6b70", textWrap: "pretty" }}>{b}</p>
        </div>
      ))}
    </div>
  );
}

export default function ComparePage() {
  return (
    <Shell label="Compare">
      <section style={{ background: HERO_BG, padding: "80px 32px 64px" }}>
        <div style={{ margin: "0 auto", display: "grid", maxWidth: 1180, gap: "24px 64px", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,420px),1fr))", alignItems: "end" }}>
          <h1 className="rise" style={{ ...H1, textWrap: "balance" }}>
            Tapry next to Riverside and the others
          </h1>
          <p className="rise" style={{ ...LEAD, animationDelay: ".08s" }}>
            The way of recording is the same. Where the recordings live, who can read the code and how much is built around it are not. This page lists both sides, including what Tapry doesn’t do.
          </p>
        </div>
      </section>

      <section style={{ borderTop: "1px solid #ececef", padding: "96px 32px" }}>
        <div style={{ margin: "0 auto", display: "flex", maxWidth: 1180, flexDirection: "column", gap: 48 }}>
          <SectionHead title="What’s the same" kicker="The core" num="1.0" />
          <Rows rows={SAME} />
        </div>
      </section>

      <section style={{ borderTop: "1px solid #ececef", padding: "96px 32px" }}>
        <div style={{ margin: "0 auto", display: "flex", maxWidth: 1180, flexDirection: "column", gap: 48 }}>
          <SectionHead title="What Tapry does that the others don’t, or keep for their top plans" kicker="Different" num="2.0" />
          <Rows rows={OURS} />
        </div>
      </section>

      <section style={{ borderTop: "1px solid #ececef", padding: "96px 32px" }}>
        <div style={{ margin: "0 auto", display: "flex", maxWidth: 1180, flexDirection: "column", gap: 48 }}>
          <SectionHead title="What Tapry doesn’t do" kicker="Missing" num="3.0" />
          <Rows rows={THEIRS} />
        </div>
      </section>

      <section style={{ borderTop: "1px solid #ececef", padding: "96px 32px" }}>
        <div style={{ margin: "0 auto", display: "grid", maxWidth: 1180, gap: "40px 64px", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,420px),1fr))" }}>
          <h2 style={{ ...H2, lineHeight: 1.2, textWrap: "balance" }}>Which one, then</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 18, fontSize: 17, lineHeight: 1.55, color: "#3a3a3c", textWrap: "pretty" }}>
            <p style={{ margin: 0 }}>
              <strong style={{ fontWeight: 500, color: "#0b0b0f" }}>Choose Tapry</strong> when the recordings must stay on your own server or in your own storage, when you need to show who agreed to what, or when you want to read and change the software.
            </p>
            <p style={{ margin: 0 }}>
              <strong style={{ fontWeight: 500, color: "#0b0b0f" }}>Choose a hosted studio like Riverside</strong> when you want to stream live, edit in the same place, record from an app, or rely on a product with years of use behind it.
            </p>
            <p style={{ margin: 0, fontSize: 15, color: "#6b6b70" }}>
              The other products were read from their own public pages on {CHECKED}; they change, so check theirs before deciding. Riverside, Zencastr, Descript and StreamYard are trademarks of their owners. What Tapry has been tested on is listed in the{" "}
              <a href={BROWSERS_DOC} style={{ color: "#0b0b0f", textDecoration: "underline", textUnderlineOffset: 3 }}>browser support notes</a>.
            </p>
          </div>
        </div>
      </section>

      <CtaRow title="The quickest comparison is one recording of your own.">
        <DarkBtn href={SETUP_GUIDE}>Run it on your server</DarkBtn>
        <OutlineBtn href={GET_STARTED}>{HAS_CLOUD ? "Start on Tapry Cloud" : "See the plans"}</OutlineBtn>
      </CtaRow>
    </Shell>
  );
}
