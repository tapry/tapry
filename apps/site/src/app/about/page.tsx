import { BrandPanel, CtaRow, DarkBtn, H1, H2, HERO_BG, LEAD, OutlineBtn, SectionHead, Shell } from "@/components/ui";
import { BUG_REPORT_URL, CONTRIBUTING_URL, pageMeta } from "@/content/site";

export const metadata = pageMeta({
  title: "About Tapry: recordings should outlive the tools that made them",
  description: "Tapry is an open-source remote recording studio: full quality, self-hosted, readable to the last line. AGPL-3.0 server, MIT recorder.",
  path: "/about/",
});

const PRINCIPLES: Array<[string, string, string]> = [
  ["01", "Local first", "A recording is saved on the guest’s own computer before a single byte goes anywhere. Networks fail; disks mostly don’t."],
  ["02", "Your storage, your keys", "Files land in storage you control. When you host Tapry yourself, there is no Tapry account that can read them."],
  ["03", "Readable code", "Every promise about data should map to a line of config or source you can point at."],
  ["04", "Guests shouldn’t notice", "No installs, no accounts, plain-language advice instead of alarms. The hard parts belong to the host."],
];

export default function AboutPage() {
  return (
    <Shell active="company" label="Company">
      <section style={{ background: HERO_BG, padding: "80px 32px 64px" }}>
        <div style={{ margin: "0 auto", display: "grid", maxWidth: 1180, gap: "24px 64px", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,420px),1fr))", alignItems: "end" }}>
          <h1 className="rise" style={{ ...H1, textWrap: "balance" }}>
            Recordings should outlive the tools that made them
          </h1>
          <p className="rise" style={{ ...LEAD, animationDelay: ".08s" }}>
            Tapry is an open-source project building a remote studio you can own: full quality, self-hosted, readable to the last line.
          </p>
        </div>
      </section>
      <section style={{ padding: "0 32px 96px" }}>
        <div className="rise9" style={{ margin: "0 auto", maxWidth: 1180, position: "relative", aspectRatio: "21/9", overflow: "hidden", borderRadius: 20, background: "#0b0b0f", animationDelay: ".16s" }}>
          <BrandPanel />
        </div>
      </section>

      <section style={{ borderTop: "1px solid #ececef", padding: "96px 32px" }}>
        <div style={{ margin: "0 auto", display: "grid", maxWidth: 1180, gap: "40px 64px", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,420px),1fr))" }}>
          <h2 style={{ ...H2, lineHeight: 1.2, textWrap: "balance" }}>Why it exists</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 18, fontSize: 17, lineHeight: 1.55, color: "#3a3a3c", textWrap: "pretty" }}>
            <p style={{ margin: 0 }}>Remote recordings usually go wrong in the same place: the call. When a connection struggles, the call gives up quality, and a recording made from the call keeps the damage.</p>
            <p style={{ margin: 0 }}>
              So Tapry records each guest on their own computer, saves every piece there before anything is sent, and uploads piece by piece, during the session, to storage you own. The call is only the preview.
            </p>
            <p style={{ margin: 0 }}>The server is AGPL-3.0 so improvements stay shared; the recorder core is MIT so anyone can build on it.</p>
          </div>
        </div>
      </section>

      <section style={{ borderTop: "1px solid #ececef", padding: "96px 32px" }}>
        <div style={{ margin: "0 auto", display: "flex", maxWidth: 1180, flexDirection: "column", gap: 48 }}>
          <SectionHead title="What Tapry holds to" kicker="Principles" num="1.0" />
          <div style={{ display: "grid", gap: "40px 32px", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,240px),1fr))" }}>
            {PRINCIPLES.map(([n, t, b]) => (
              <div key={n} className="reveal" style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: "1px solid #0b0b0f", paddingTop: 18 }}>
                <span style={{ fontSize: 13, color: "#737378" }}>{n}</span>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 500, letterSpacing: "-.015em" }}>{t}</h3>
                <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: "#6b6b70", textWrap: "pretty" }}>{b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <CtaRow title="Want to help? Bug reports with browser details count as much as code.">
        <DarkBtn href={CONTRIBUTING_URL}>Contributing guide</DarkBtn>
        <OutlineBtn href={BUG_REPORT_URL}>Report a bug</OutlineBtn>
      </CtaRow>
    </Shell>
  );
}
