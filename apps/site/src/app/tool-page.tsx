// The frame every free tool shares (Tools design): the hero, the tool, "Need to record guests?
// Try Tapry." (the plan's line for every tool), then questions for people arriving from search.
import { Faq } from "@/components/faq";
import { DarkBtn, H2, OutlineBtn, Shell } from "@/components/ui";

export function ToolPage({ title, intro, faq, children }: { title: string; intro: string; faq: Array<[string, string]>; children: React.ReactNode }) {
  return (
    <Shell active="resources" label="Free tools">
      <section style={{ background: "linear-gradient(180deg,#fbe3d8 0%,#fff 100%)", padding: "80px 28px 40px" }}>
        <div style={{ margin: "0 auto", display: "flex", maxWidth: 1180, flexDirection: "column", gap: 16 }}>
          <span style={{ fontSize: 14, color: "#5f6470" }}>
            <a href="/tools/" className="hv-red" style={{ color: "#5f6470" }}>
              Free tools
            </a>{" "}
            · No sign-up
          </span>
          <h1 className="rise" style={{ margin: 0, fontSize: "clamp(36px,4vw,52px)", lineHeight: 1.06, fontWeight: 500, letterSpacing: "-.03em", textWrap: "balance" }}>
            {title}
          </h1>
          <p style={{ margin: 0, maxWidth: 640, fontSize: 18, lineHeight: 1.5, color: "#5f6470", textWrap: "pretty" }}>{intro}</p>
        </div>
      </section>
      <section style={{ padding: "24px 28px 96px" }}>
        <div style={{ margin: "0 auto", maxWidth: 1180 }}>
          <div style={{ maxWidth: 640 }}>{children}</div>
        </div>
      </section>

      <section style={{ borderTop: "1px solid #ececef", padding: "96px 32px" }}>
        <div style={{ margin: "0 auto", display: "flex", maxWidth: 1180, alignItems: "center", justifyContent: "space-between", gap: 24, flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 640 }}>
            <h2 style={{ ...H2, textWrap: "balance" }}>Need to record guests? Try Tapry.</h2>
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55, color: "#6b6b70" }}>Everyone is recorded in full quality on their own computer, even on bad Wi-Fi, and the files line up by themselves. Free and open source.</p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <DarkBtn href="/">See how it works</DarkBtn>
            <OutlineBtn href="/self-hosting/">Self-host it</OutlineBtn>
          </div>
        </div>
      </section>

      <section style={{ borderTop: "1px solid #ececef", padding: "96px 32px" }}>
        <div style={{ margin: "0 auto", display: "grid", maxWidth: 1180, gap: "40px 64px", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,360px),1fr))", alignItems: "start" }}>
          <h2 style={H2}>Common questions</h2>
          <Faq items={faq} />
        </div>
      </section>
    </Shell>
  );
}
