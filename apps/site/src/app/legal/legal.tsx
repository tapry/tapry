// Privacy and Terms, one after the other on one page (#privacy, #terms), so both are in the
// static files and the links work without script. A draft for the owner to review: it describes
// this website, the self-hosted software and (with the hosted app's address set) Tapry Cloud as
// they are. The Cloud sections state what the software does (docs/cloud-billing.md) and who
// handles data; the fuller texts, with the operator's legal details, are in docs/legal-drafts.md.
import { CONTACT_EMAIL, HAS_CLOUD, HAS_SPEED_TEST, HAS_WAITLIST } from "@/content/site";
import { HAS_CHECKOUT, PADDLE_TOKEN } from "@/content/tiers";

type Doc = { id: "privacy" | "terms"; title: string; sections: Array<[string, string]> };

const CLOUD_PRIVACY: Array<[string, string]> = [
  [
    "Tapry Cloud: your account",
    "To host recordings on Tapry Cloud you create an account with a name, an email address and a password. The password is stored only as a hash. One cookie keeps you signed in. Tapry Cloud runs no analytics, advertising or tracking.",
  ],
  [
    "Tapry Cloud: recordings",
    "Each person’s sound and picture, the finished files and the transcripts are stored on our servers in Finland. The original uploads are removed 7 days after a recording is processed; the finished files are kept for the number of days your plan says, then the recording is deleted, and each recording shows its date. Transcripts are made on our own servers. They are not sent to any AI company, with one exception that is off unless you turn it on: if your account’s owner switches on AI notes in Settings, the transcript text of your recordings (never sound or picture) is sent to Anthropic, whose Claude model writes the notes, under Anthropic’s own terms and privacy policy. Recordings are never used to train anything, and sound, picture, transcript text and email addresses are never written to logs.",
  ],
  [
    "Tapry Cloud: payments",
    (HAS_CHECKOUT ? "Paid plans are sold" : "Paid plans aren’t on sale yet. When they are, they will be sold") + " by Paddle, our payment provider and merchant of record: Paddle takes the payment, handles tax and sends the invoice, under its own privacy policy. No card detail reaches Tapry. We keep Paddle’s identifiers for your customer record and subscription, so your account gets the plan you paid for. The checkout and payment pages load Paddle’s scripts, including Paddle Retain; the rest of the app doesn’t.",
  ],
  [
    "Who else handles data",
    "Hetzner hosts the servers and the stored recordings, in Finland. Anthropic writes AI notes from transcript text, only for accounts that switched AI notes on. " + (HAS_CHECKOUT ? "Paddle handles payments. " : "") + "Cloudflare hosts this website and forwards mail sent to our contact address. We don’t sell or share data with anyone else.",
  ],
  [
    "Your rights",
    `You can see, correct, download and delete what Tapry Cloud holds about you: write to ${CONTACT_EMAIL}. A guest who wants their part of a recording removed should ask the host who recorded them; we help the host do it.`,
  ],
];

const CLOUD_TERMS: Array<[string, string]> = [
  [
    "Tapry Cloud: plans",
    "A plan gives you a number of recording hours each billing month and a time your finished files are kept; the pricing page lists them. Hours are counted per recording, not per person, and a deleted recording still counts. When a month’s hours are used up you can’t start a new recording until the next month or a bigger plan. A recording that is running is never cut off.",
  ],
  [
    "Tapry Cloud: how long recordings are kept",
    "The original uploads are removed 7 days after a recording is processed. The finished files are kept for your plan’s number of days, counted from when they were first ready; then the recording is deleted. Moving to a bigger plan extends the time for recordings you already have; a smaller plan never shortens it. Deleted recordings can’t be recovered: download what you want to keep.",
  ],
  [
    "Tapry Cloud: paying, cancelling and refunds",
    `${HAS_CHECKOUT ? "Plans are sold" : "Paid plans aren’t on sale yet. When they are, they will be sold"} through Paddle and renew each month or year until you cancel. You can cancel at any time from Settings, Plan: the plan then runs to the end of the period you paid for and the account moves to the Free plan. If Tapry Cloud isn’t for you, write to ${CONTACT_EMAIL} within 14 days of your first payment and it is refunded in full.`,
  ],
];

const DOCS: Doc[] = [
  {
    id: "privacy",
    title: "Privacy Policy",
    sections: [
      [
        "This website",
        PADDLE_TOKEN
          ? "This site is a set of static pages. It sets no cookies and runs no analytics of its own. One page loads scripts from another company: the pricing page loads Paddle’s, our payment provider, to show prices in your currency. Paddle’s script also loads Paddle Retain, which Paddle uses for payment recovery and cancellation offers and which may set its own cookies, under Paddle’s privacy policy. No other page of this site loads anything from another company. Like any web server, the host serving it may keep ordinary access logs."
          : `This site is a set of static pages. It sets no cookies, runs no analytics or trackers, and loads no fonts or scripts from other companies.${HAS_CLOUD ? " To show the right menu, each page asks Tapry Cloud whether this browser is signed in; the answer is only yes or no, and is remembered in this browser." : ""} Like any web server, the host serving it may keep ordinary access logs.`,
      ],
      [
        "The free tools",
        `The mic and camera test, the voice and video recorder, the consent form generator and the recording data map run entirely in your browser: nothing they hear, see or are told is sent anywhere, and a recording is gone when you close the tab unless you save it to your own computer.${HAS_SPEED_TEST ? " The upload speed test sends throwaway data to a Tapry server, which reads it and discards it; it keeps a short-lived count per network address to limit how much one address can send." : ""}`,
      ],
      [
        "The waitlist",
        HAS_WAITLIST
          ? "If you join the waitlist for a paid plan, the email address you type and the plan you asked about are sent to the Tapry Cloud server in Finland and kept there, not with a form service. They are used only to tell you when that plan opens, with one email. Write to us and we remove you from the list."
          : "There is no waitlist form on this site yet; nothing you do here is stored.",
      ],
      [
        "Self-hosted Tapry",
        "When you run Tapry on your own server, recordings, transcripts and guest details stay on that server and in the storage you choose. Tapry’s maintainers never receive them, and the server sends nothing to the project: the optional update check only asks GitHub for the latest release when you turn it on.",
      ],
      [
        "Guests",
        "Guests give a name and agree to the studio’s consent text before joining. The exact text and when they agreed are kept with the recording, for the host who runs that server. A guest who sends tech-check results sends their name, browser and the checks’ outcomes, no media. If the host’s server offers a recap email and the guest asks for one, their address is kept on that server only until the email is sent or given up on.",
      ],
      ...(HAS_CLOUD
        ? CLOUD_PRIVACY
        : ([["Tapry Cloud", "Tapry Cloud, a hosted version, is not available yet. Before it opens, this policy will say what it stores and where."]] as Array<[string, string]>)),
    ],
  },
  {
    id: "terms",
    title: "Terms of Service",
    sections: [
      ["The software", "Tapry’s server is licensed under AGPL-3.0 and the recorder core under MIT. Those licences govern your use of the code."],
      ["Your recordings", "You own what you record. You are responsible for having each guest’s permission to record them and to publish what you record."],
      ["Acceptable use", "Don’t use Tapry to record people without their knowledge, or to break the law where you or your guests are."],
      ...(HAS_CLOUD
        ? CLOUD_TERMS
        : ([["Tapry Cloud", "Tapry Cloud isn’t available yet. The plans on the pricing page are planned and may change before it opens; its terms will be published here first."]] as Array<[string, string]>)),
      [
        "No warranty",
        `The self-hosted software is provided as is, without warranty. Keep your own backups of anything you can’t afford to lose.${HAS_CLOUD ? " We work to keep Tapry Cloud running and your recordings safe, but don’t promise uninterrupted service." : ""}`,
      ],
    ],
  },
];

export function Legal() {
  return (
    <>
      <section style={{ background: "linear-gradient(180deg,#fbe3d8 0%,#fff 100%)", padding: "80px 28px 32px" }}>
        <div style={{ margin: "0 auto", display: "flex", maxWidth: 760, flexDirection: "column", gap: 18 }}>
          <h1 style={{ margin: 0, fontSize: "clamp(34px,4vw,48px)", lineHeight: 1.08, fontWeight: 500, letterSpacing: "-.03em" }}>Privacy and terms</h1>
          <span style={{ fontSize: 14, color: "#5f6470" }}>Draft for review · last updated November 2026</span>
          <nav aria-label="On this page" style={{ display: "flex", alignSelf: "flex-start", gap: 2, borderRadius: 8, background: "#f4f4f5", padding: 3 }}>
            {DOCS.map((d) => (
              <a key={d.id} href={`#${d.id}`} className="chip" style={{ display: "inline-flex", height: 30, alignItems: "center", borderRadius: 6, padding: "0 12px", fontSize: 14, fontWeight: 500, background: "#fff", color: "#09090b", boxShadow: "0 1px 3px rgba(0,0,0,.1)" }}>
                {d.title}
              </a>
            ))}
          </nav>
        </div>
      </section>
      {DOCS.map((d) => (
        <section key={d.id} id={d.id} aria-labelledby={`${d.id}-title`} style={{ padding: "16px 28px 72px", scrollMarginTop: 72 }}>
          <div style={{ margin: "0 auto", display: "flex", maxWidth: 760, flexDirection: "column", gap: 28 }}>
            <h2 id={`${d.id}-title`} style={{ margin: 0, fontSize: "clamp(26px,2.6vw,32px)", fontWeight: 500, letterSpacing: "-.03em" }}>
              {d.title}
            </h2>
            {d.sections.map(([h, p]) => (
              <div key={h} style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid #e4e4e7", paddingTop: 24 }}>
                <h3 style={{ margin: 0, fontSize: 20, fontWeight: 500, letterSpacing: "-.02em" }}>{h}</h3>
                <p style={{ margin: 0, fontSize: 16, lineHeight: 1.65, color: "#3f3f46", textWrap: "pretty" }}>{p}</p>
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
