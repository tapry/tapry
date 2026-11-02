// The frame every free tool shares: logo, title, the tool, "Need to record guests? Try Tapry."
// (the plan's line for every tool), then questions and answers for people arriving from search.
export function ToolPage({
  title,
  intro,
  faq,
  children,
}: {
  title: string;
  intro: string;
  faq: Array<[string, string]>;
  children: React.ReactNode;
}) {
  return (
    <div style={{ minHeight: "100vh", background: "#f6f5f3" }}>
      <header style={{ maxWidth: 1180, margin: "0 auto", padding: "0 20px", height: 76, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        <a href="/" aria-label="Tapry home" style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 700, fontSize: 22, letterSpacing: "-.02em", color: "#1d1d1f" }}>
          <span style={{ position: "relative", width: 24, height: 24 }}>
            <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "#fbd5cc", transform: "translate(4px,3px)" }} />
            <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "#e8553d" }} />
          </span>
          Tapry
        </a>
        <a href="/" style={{ fontSize: 15, fontWeight: 500, color: "#1d1d1f" }}>
          Record a podcast →
        </a>
      </header>

      <main style={{ maxWidth: 1180, margin: "0 auto", padding: "24px 20px 72px", display: "flex", flexDirection: "column", gap: 28 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 760 }}>
          <span style={{ fontFamily: "var(--mono)", fontSize: 13, letterSpacing: ".12em", color: "#c43c25" }}>FREE TOOL · NO SIGN-UP</span>
          <h1 style={{ margin: 0, fontSize: "clamp(34px,5vw,56px)", fontWeight: 700, lineHeight: 1.05, letterSpacing: "-.035em" }}>{title}</h1>
          <p style={{ margin: 0, fontSize: "clamp(17px,1.6vw,20px)", color: "#6e6e73", lineHeight: 1.5 }}>{intro}</p>
        </div>

        {children}

        <section style={{ borderRadius: 22, background: "#1d1d1f", color: "#ffffff", padding: "30px 28px", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 18 }}>
          <span style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 640 }}>
            <span style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-.02em" }}>Need to record guests? Try Tapry.</span>
            <span style={{ fontSize: 16, color: "#c7c7cc", lineHeight: 1.5 }}>
              Everyone is recorded in full quality on their own computer, even on bad Wi-Fi, and the files line up by themselves.
              Free and open source.
            </span>
          </span>
          <a href="/" className="cta" style={{ padding: "16px 26px", borderRadius: 14, background: "#e8553d", color: "#ffffff", fontWeight: 600, fontSize: 17, whiteSpace: "nowrap" }}>
            See how it works
          </a>
        </section>

        <section style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 820 }}>
          <h2 style={{ margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: "-.02em" }}>Common questions</h2>
          {faq.map(([q, a]) => (
            <div key={q} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{q}</h3>
              <p style={{ margin: 0, fontSize: 16, lineHeight: 1.6, color: "#3a3a3c" }}>{a}</p>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
