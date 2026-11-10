import { Faq } from "@/components/faq";
import { CtaRow, DarkBtn, H2, OutlineBtn, SectionHead, Shell } from "@/components/ui";
import { CLOUD_NEWS, pageMeta } from "@/content/site";
import { Plans } from "./pricing";

export const metadata = pageMeta({
  title: "Pricing: free to self-host · Tapry",
  description: `Self-hosting Tapry is free, with no limits on recordings or hours (AGPL-3.0). Tapry Cloud, a hosted version, is planned and not open yet: ${CLOUD_NEWS} to hear when it is.`,
  path: "/pricing/",
});

// [label, self-hosted, Cloud Creator, Cloud Studio]; a row with no values is a group heading.
// The Self-hosted column describes the software as released. The Cloud columns are the plan
// (docs/plan/06-monetization.md): only what it states; "—" where it doesn't say.
const ROWS: Array<[string, string?, string?, string?]> = [
  ["Plan"],
  ["Price", "$0", "$9 / month", "$19 / month"],
  ["Recording hours", "Unlimited", "20 / month", "60 / month"],
  ["Seats", "Your server, your accounts", "—", "3"],
  ["File retention", "You decide", "90 days", "—"],
  ["Transcripts", "whisper.cpp on your server", "Included", "—"],
  ["Where files live", "Bundled SeaweedFS or your S3 bucket", "Tapry Cloud", "Tapry Cloud"],
  ["Support", "GitHub issues", "—", "—"],
  ["The software today"],
  ["Guests per recording", "Up to 7"],
  ["Audio", "48 kHz WAV or FLAC"],
  ["Video", "1080p, 720p or audio only"],
  ["Per-person files + combined video", "✓"],
  ["Tech-check link and producer alerts", "✓"],
];

const FAQ: Array<[string, string]> = [
  ["Is self-hosting really free?", "Yes. Tapry’s server is AGPL-3.0 and the recorder core is MIT. You pay for your own machine and storage, nothing to Tapry."],
  [
    "What does self-hosting require?",
    "A Linux server with Docker (at least 2 vCPU and 4 GB of RAM), four DNS names pointing at it and a few open ports. The Compose bundle includes Caddy for HTTPS and SeaweedFS for storage; an S3-compatible bucket works too.",
  ],
  [
    "When does Tapry Cloud open, and can I keep files in my own bucket?",
    `Tapry Cloud isn’t available yet, and the plans above may still change. The plan also has a $6 a month option that records into your own S3 or R2 bucket with no limit on hours. To hear when it opens, ${CLOUD_NEWS}.`,
  ],
  ["Do guests need an account?", "No. Guests join from a link in desktop Chrome, Firefox or Safari. A green room checks their browser, camera, microphone and free space, and asks about headphones, first."],
  ["What happens if a guest’s connection drops?", "Their browser keeps recording to its own storage and uploads the rest when they’re back. The call might blur; the files don’t."],
];

export default function PricingPage() {
  return (
    <Shell active="pricing" label="Pricing">
      <Plans />

      <section style={{ borderTop: "1px solid #ececef", padding: "96px 32px" }}>
        <div style={{ margin: "0 auto", display: "flex", maxWidth: 1180, flexDirection: "column", gap: 40 }}>
          <SectionHead title="Compare plans" kicker="Pricing" num="1.0" />
          <div className="x-scroll">
            <div role="table" aria-label="Compare plans" style={{ minWidth: 720, display: "flex", flexDirection: "column", fontSize: 14 }}>
              <div role="row" style={{ ...grid, padding: "10px 0", borderBottom: "1px solid #0b0b0f", color: "#737378" }}>
                <span role="columnheader">
                  <span className="sr">Feature</span>
                </span>
                <span role="columnheader">Self-hosted</span>
                <span role="columnheader">Cloud Creator (planned)</span>
                <span role="columnheader">Cloud Studio (planned)</span>
              </div>
              {ROWS.map(([label, a, b, c], i) => {
                const head = a === undefined;
                return (
                  <div role="row" key={label + i} style={{ ...grid, padding: "12px 0", borderBottom: "1px solid #f1f1f3" }}>
                    <span role="rowheader" style={{ color: head ? "#737378" : "#0b0b0f", fontWeight: head ? 400 : 500 }}>
                      {label}
                    </span>
                    <span role="cell" style={{ color: "#3a3a3c" }}>{a ?? ""}</span>
                    <span role="cell" style={{ color: "#3a3a3c" }}>{b ?? ""}</span>
                    <span role="cell" style={{ color: "#3a3a3c" }}>{c ?? ""}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <p style={{ margin: 0, fontSize: 13, color: "#6b6b70" }}>
            Tapry Cloud isn’t available yet: its columns are the plan, not something you can buy today, and may change. “—” means the plan doesn’t say yet. Paid yearly, the planned price is ten months’ worth.
          </p>
        </div>
      </section>

      <section style={{ borderTop: "1px solid #ececef", padding: "96px 32px" }}>
        <div style={{ margin: "0 auto", display: "grid", maxWidth: 1180, gap: "40px 64px", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,360px),1fr))", alignItems: "start" }}>
          <h2 style={H2}>Questions</h2>
          <Faq items={FAQ} />
        </div>
      </section>

      <CtaRow title="Not sure which fits? Start self-hosted today; Tapry Cloud is planned.">
        <DarkBtn href="/self-hosting/">Self-host Tapry</DarkBtn>
        <OutlineBtn href="/resources/#help">Get help</OutlineBtn>
      </CtaRow>
    </Shell>
  );
}

const grid = { display: "grid", gridTemplateColumns: "minmax(0,2fr) repeat(3,minmax(0,1fr))", gap: 16 } as const;
