// Privacy and Terms, one after the other on one page (#privacy, #terms), so both are in the
// static files and the links work without script. A draft for the owner to review: it describes
// this website and the self-hosted software as they are; Tapry Cloud isn't available yet.
import { HAS_SPEED_TEST, HAS_WAITLIST } from "@/content/site";

type Doc = { id: "privacy" | "terms"; title: string; sections: Array<[string, string]> };

const DOCS: Doc[] = [
  {
    id: "privacy",
    title: "Privacy Policy",
    sections: [
      ["This website", "This site is a set of static pages. It sets no cookies, runs no analytics or trackers, and loads no fonts or scripts from other companies. Like any web server, the host serving it may keep ordinary access logs."],
      [
        "The free tools",
        `The mic and camera test runs entirely in your browser: nothing it hears or sees is recorded or sent anywhere, and its test recording is gone when you close the tab.${HAS_SPEED_TEST ? " The upload speed test sends throwaway data to a Tapry server, which reads it and discards it; it keeps a short-lived count per network address to limit how much one address can send." : ""}`,
      ],
      [
        "The waitlist",
        HAS_WAITLIST
          ? "If you join the Tapry Cloud waitlist, the email address you type is sent to the form service that collects the list, and used only to tell you when Tapry Cloud opens."
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
      ["Tapry Cloud", "Tapry Cloud, a hosted version, is not available yet. Before it opens, this policy will say what it stores and where."],
    ],
  },
  {
    id: "terms",
    title: "Terms of Service",
    sections: [
      ["The software", "Tapry’s server is licensed under AGPL-3.0 and the recorder core under MIT. Those licences govern your use of the code."],
      ["Your recordings", "You own what you record. You are responsible for having each guest’s permission to record them and to publish what you record."],
      ["Acceptable use", "Don’t use Tapry to record people without their knowledge, or to break the law where you or your guests are."],
      ["Tapry Cloud", "Tapry Cloud isn’t available yet. The plans on the pricing page are planned and may change before it opens; its terms will be published here first."],
      ["No warranty", "The self-hosted software is provided as is, without warranty. Keep your own backups of anything you can’t afford to lose."],
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
