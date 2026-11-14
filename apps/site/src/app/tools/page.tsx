import { Shell } from "@/components/ui";
import { HAS_SPEED_TEST, pageMeta } from "@/content/site";
import { MicCard } from "./mic-card";
import { RecorderCard } from "./recorder-card";
import { SpeedCard } from "./speed-card";

export const metadata = pageMeta({
  title: HAS_SPEED_TEST ? "Free tools: mic, camera and upload speed test · Tapry" : "Free tools: mic and camera test · Tapry",
  description: `Check your microphone${HAS_SPEED_TEST ? ", camera and upload speed" : " and camera"} before any call, Tapry or not. No sign-up; the mic test runs entirely in your browser.`,
  path: "/tools/",
});

export default function ToolsPage() {
  return (
    <Shell active="resources" label="Free tools">
      <section style={{ background: "linear-gradient(180deg,#fbe3d8 0%,#fff 100%)", padding: "80px 28px 40px" }}>
        <div style={{ margin: "0 auto", display: "flex", maxWidth: 1180, flexDirection: "column", gap: 16 }}>
          <h1 className="rise" style={{ margin: 0, fontSize: "clamp(36px,4vw,52px)", lineHeight: 1.06, fontWeight: 500, letterSpacing: "-.03em" }}>
            Free tools
          </h1>
          <p style={{ margin: 0, maxWidth: 560, fontSize: 18, lineHeight: 1.5, color: "#5f6470", textWrap: "pretty" }}>
            Small tools for anyone who records, Tapry or not. No sign-up, and nothing from your microphone or camera is sent anywhere.
          </p>
        </div>
      </section>
      <section style={{ padding: "24px 28px 110px" }}>
        <div style={{ margin: "0 auto", display: "grid", maxWidth: 1180, gap: 16, gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,420px),1fr))", alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <MicCard />
            <a href="/mic-test/" style={{ fontSize: 14, color: "#5f6470", paddingLeft: 4 }}>
              More about the mic test →
            </a>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <RecorderCard />
            <a href="/recorder/" style={{ fontSize: 14, color: "#5f6470", paddingLeft: 4 }}>
              More about the recorder →
            </a>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <a href="/consent-form/" style={{ display: "flex", flexDirection: "column", gap: 8, border: "1px solid #ececef", borderRadius: 20, padding: 22, color: "#0b0b0f" }}>
              <span style={{ fontSize: 17, fontWeight: 500 }}>Consent form generator</span>
              <span style={{ fontSize: 14.5, lineHeight: 1.5, color: "#5f6470" }}>A plain-language recording consent form for interviews, podcasts and research sessions, ready to copy or save.</span>
              <span style={{ fontSize: 14, fontWeight: 500 }}>Make a form →</span>
            </a>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <a href="/data-map/" style={{ display: "flex", flexDirection: "column", gap: 8, border: "1px solid #ececef", borderRadius: 20, padding: 22, color: "#0b0b0f" }}>
              <span style={{ fontSize: 17, fontWeight: 500 }}>Recording data map</span>
              <span style={{ fontSize: 14.5, lineHeight: 1.5, color: "#5f6470" }}>A plain record of what your recordings collect, where they are stored, who handles them and how long they are kept, for GDPR and ethics reviews.</span>
              <span style={{ fontSize: 14, fontWeight: 500 }}>Make a data map →</span>
            </a>
          </div>
          {HAS_SPEED_TEST && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <SpeedCard />
              <a href="/upload-speed-test/" style={{ fontSize: 14, color: "#5f6470", paddingLeft: 4 }}>
                How much upload you need →
              </a>
            </div>
          )}
        </div>
      </section>
    </Shell>
  );
}
