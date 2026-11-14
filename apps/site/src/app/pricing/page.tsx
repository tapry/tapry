import { Faq } from "@/components/faq";
import { CtaRow, DarkBtn, H2, OutlineBtn, SectionHead, Shell } from "@/components/ui";
import { checkoutUrl, CLOUD_NEWS, CONTACT_EMAIL, HAS_CLOUD, pageMeta, SIGNUP_URL } from "@/content/site";
import { HAS_CHECKOUT } from "@/content/tiers";
import { Plans } from "./pricing";

export const metadata = pageMeta({
  title: "Pricing: free to self-host · Tapry",
  description: HAS_CLOUD
    ? `Self-hosting Tapry is free, with no limits on recordings or hours (AGPL-3.0). Tapry Cloud, the hosted version, starts free${HAS_CHECKOUT ? " and has plans from $19 a month" : "; paid plans from $19 a month open soon"}.`
    : `Self-hosting Tapry is free, with no limits on recordings or hours (AGPL-3.0). Tapry Cloud, a hosted version, is planned and not open yet: ${CLOUD_NEWS} to hear when it is.`,
  path: "/pricing/",
});

// [label, self-hosted, Cloud Creator, Cloud Studio, Cloud Team]; a row with no values is a group heading.
// The Self-hosted column describes the software as released. The Cloud columns are the plan
// (docs/plan/06-monetization.md, pricing v4): only what it states.
const ROWS: Array<[string, string?, string?, string?, string?]> = [
  ["Plan"],
  ["Price", "$0", "$19 / month", "$39 / month", "$149 / month"],
  ["Paid yearly", "—", "$190", "$390", "$1,490"],
  ["Recording hours", "Unlimited", "15 / month", "40 / month", "80 / month"],
  ["Extra hours", "—", "$2 each", "$2 each", "$2 each"],
  ["Seats", "Your server, your accounts", "1", "3", "5"],
  ["Video", "Up to 4K", "Full HD", "Up to 4K", "Up to 4K"],
  ["Your logo and colour on guest pages", "✓", "—", "✓", "✓"],
  ["Finished files kept", "You decide", "30 days", "60 days", "90 days"],
  ["Original uploads kept", "You decide", "7 days", "7 days", "7 days"],
  ["Transcripts", "whisper.cpp on your server", "Included", "Included", "Included"],
  ["AI notes (summary, chapters, quotes)", "With your own model, or your own Claude key", "Opt-in", "Opt-in", "Opt-in"],
  ["Where files live", "Bundled SeaweedFS or your S3 bucket", "Tapry Cloud, in the EU", "Tapry Cloud, in the EU", "Tapry Cloud, in the EU"],
  ["Support", "GitHub issues", "—", "—", "Email"],
  ["The software today"],
  ["People per recording", "Up to 8"],
  ["Audio", "48 kHz WAV or FLAC"],
  ["Video", "Up to 4K, 1080p, 720p or audio only"],
  ["Per-person files + combined video", "✓"],
  ["Screen sharing, recorded as its own file", "✓"],
  ["Tech-check link and producer alerts", "✓"],
  ["Guest pages in English, French, Spanish, German, Portuguese and Arabic", "✓"],
];

// Offers beside the three cloud plans, from the same document: [name, price, what it is, link, link label].
// A link only where the offer can be taken up today; the rest say how to ask.
const MORE: Array<[string, string, string, string | null, string | null]> = [
  ["Free cloud", "$0", "2 recording hours a month, finished files kept 7 days. Guests see a “Record your own” link at the end.", HAS_CLOUD ? SIGNUP_URL : null, "Start free"],
  ["Own storage", "$12 a month", "Tapry Cloud runs the studio and records into your own S3 or R2 bucket, with no limit on hours within fair use.", HAS_CHECKOUT ? checkoutUrl("own_storage", false) : null, "Choose Own storage"],
  ["Support for self-hosting", "$2,400 a year", "For an organisation running Tapry on its own server: email support, help with updates and the documents a data-protection review asks for.", `mailto:${CONTACT_EMAIL}`, "Write to us"],
  ["Business", "From $4,800 a year", "Hosted, with single sign-on, an audit log and retention policies. These features aren’t built yet.", `mailto:${CONTACT_EMAIL}`, "Write to us"],
];
/** Which of those exist today, for the "planned" label. */
const AVAILABLE = new Set(HAS_CLOUD ? ["Free cloud", ...(HAS_CHECKOUT ? ["Own storage"] : []), "Support for self-hosting"] : []);

const FAQ: Array<[string, string]> = [
  ["Is self-hosting really free?", "Yes. Tapry’s server is AGPL-3.0 and the recorder core is MIT. You pay for your own machine and storage, nothing to Tapry."],
  [
    "What does self-hosting require?",
    "A Linux server with Docker (at least 2 vCPU and 4 GB of RAM), four DNS names pointing at it and a few open ports. The Compose bundle includes Caddy for HTTPS and SeaweedFS for storage; an S3-compatible bucket works too.",
  ],
  [
    HAS_CLOUD ? "Can I keep files in my own bucket?" : "When does Tapry Cloud open, and can I keep files in my own bucket?",
    HAS_CLOUD
      ? "Yes. The Own storage plan, $12 a month, records into your own S3 or R2 bucket, with no limit on hours within fair use. You connect the bucket on the Storage page, and Tapry checks it can write there before using it."
      : `Tapry Cloud isn’t available yet, and the plans above may still change. The plan also has a $12 a month option that records into your own S3 or R2 bucket, with no limit on hours within fair use. To hear when it opens, ${CLOUD_NEWS}.`,
  ],
  [
    "How will recording hours be counted?",
    "Per recording, not per person: an hour with four people is one hour. The cloud plans keep the original uploads for 7 days after processing and the finished files for the plan’s period; download what you want to keep longer. Each recording shows its date.",
  ],
  ["Is there a discount for schools and non-profits?", `Education and non-profit organisations get 30% off the Creator, Studio and Team plans: write to ${CONTACT_EMAIL} from your organisation’s address. Self-hosting is free for everyone.`],
  ...(HAS_CLOUD && !HAS_CHECKOUT
    ? ([
        ["When can I buy a paid plan?", "Soon. The free plan is open now. Join the waitlist on the plan you want and you get one email when it can be bought; the prices above are the ones planned and may still change."],
      ] as Array<[string, string]>)
    : []),
  ...(HAS_CHECKOUT
    ? ([
        ["How do I pay, and can I cancel?", "Plans are sold through Paddle, our payment provider, which takes the payment and sends the invoice. You can cancel at any time from Settings, Plan: the plan then runs to the end of the period you paid for."],
      ] as Array<[string, string]>)
    : []),
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
            <div role="table" aria-label="Compare plans" style={{ minWidth: 900, display: "flex", flexDirection: "column", fontSize: 14 }}>
              <div role="row" style={{ ...grid, padding: "10px 0", borderBottom: "1px solid #0b0b0f", color: "#737378" }}>
                <span role="columnheader">
                  <span className="sr">Feature</span>
                </span>
                <span role="columnheader">Self-hosted</span>
                <span role="columnheader">Cloud Creator{HAS_CLOUD ? "" : " (planned)"}</span>
                <span role="columnheader">Cloud Studio{HAS_CLOUD ? "" : " (planned)"}</span>
                <span role="columnheader">Cloud Team{HAS_CLOUD ? "" : " (planned)"}</span>
              </div>
              {ROWS.map(([label, a, b, c, d], i) => {
                const head = a === undefined;
                return (
                  <div role="row" key={label + i} style={{ ...grid, padding: "12px 0", borderBottom: "1px solid #f1f1f3" }}>
                    <span role="rowheader" style={{ color: head ? "#737378" : "#0b0b0f", fontWeight: head ? 400 : 500 }}>
                      {label}
                    </span>
                    <span role="cell" style={{ color: "#3a3a3c" }}>{a ?? ""}</span>
                    <span role="cell" style={{ color: "#3a3a3c" }}>{b ?? ""}</span>
                    <span role="cell" style={{ color: "#3a3a3c" }}>{c ?? ""}</span>
                    <span role="cell" style={{ color: "#3a3a3c" }}>{d ?? ""}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <p style={{ margin: 0, fontSize: 13, color: "#6b6b70" }}>
            {HAS_CHECKOUT ? "Paid yearly, a plan costs ten months’ worth. The table lists US dollars before tax; the plans above show the price in your currency, as our payment provider Paddle will charge it." : HAS_CLOUD ? "The free plan is open now; the paid plans aren’t on sale yet, and their prices, in US dollars before tax, may still change. Paid yearly, a plan costs ten months’ worth." : "Tapry Cloud isn’t available yet: its columns are the plan, not something you can buy today, and may change. Paid yearly, the planned price is ten months’ worth."}
          </p>
          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,250px),1fr))" }}>
            {MORE.map(([name, cost, text, href, label]) => (
              <div key={name} style={{ display: "flex", flexDirection: "column", gap: 8, border: "1px solid #ececef", borderRadius: 16, padding: 20 }}>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 500 }}>
                  {name} {!AVAILABLE.has(name) && <span style={{ color: "#737378", fontWeight: 400 }}>· planned</span>}
                </h3>
                <span style={{ fontSize: 20, fontWeight: 500, letterSpacing: "-.02em" }}>{cost}</span>
                <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: "#6b6b70", textWrap: "pretty" }}>{text}</p>
                {href && label && (
                  <a href={href} data-offer={name} style={{ marginTop: "auto", paddingTop: 6, fontSize: 14, fontWeight: 500, color: "#0b0b0f", textDecoration: "underline", textUnderlineOffset: 3 }}>
                    {label}
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section style={{ borderTop: "1px solid #ececef", padding: "96px 32px" }}>
        <div style={{ margin: "0 auto", display: "grid", maxWidth: 1180, gap: "40px 64px", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,360px),1fr))", alignItems: "start" }}>
          <h2 style={H2}>Questions</h2>
          <Faq items={FAQ} />
        </div>
      </section>

      <CtaRow title={HAS_CLOUD ? "Not sure which fits? Start free on Tapry Cloud, or host it yourself." : "Not sure which fits? Start self-hosted today; Tapry Cloud is planned."}>
        {HAS_CLOUD && <DarkBtn href={SIGNUP_URL}>Start free</DarkBtn>}
        <DarkBtn href="/self-hosting/">Self-host Tapry</DarkBtn>
        <OutlineBtn href="/resources/#help">Get help</OutlineBtn>
      </CtaRow>
    </Shell>
  );
}

const grid = { display: "grid", gridTemplateColumns: "minmax(0,2fr) repeat(4,minmax(0,1fr))", gap: 16 } as const;
