import type { Metadata } from "next";
import { Footer } from "@/components/footer";
import { Nav } from "@/components/nav";

export const metadata: Metadata = { title: "Page not found · Tapry", robots: { index: false } };

export default function NotFound() {
  return (
    <div data-screen-label="Not found" style={{ display: "flex", minHeight: "100vh", flexDirection: "column", background: "#fff" }}>
      <a href="#main" className="skip">
        Skip to content
      </a>
      <Nav />
      <main id="main" style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", background: "linear-gradient(180deg,#fbe3d8 0%,#fff 70%)", padding: "80px 28px" }}>
        <div style={{ display: "flex", maxWidth: 520, flexDirection: "column", alignItems: "center", gap: 18, textAlign: "center" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8, borderRadius: 6, background: "#fff", padding: "4px 10px", fontFamily: "var(--mono)", fontSize: 13, fontWeight: 500, color: "#c43c25" }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#a1a1aa" }} />
            404 · nothing recorded here
          </span>
          <h1 style={{ margin: 0, fontSize: "clamp(34px,4.4vw,52px)", lineHeight: 1.06, fontWeight: 500, letterSpacing: "-.03em", textWrap: "balance" }}>This page didn’t make the cut</h1>
          <p style={{ margin: 0, fontSize: 17, lineHeight: 1.55, color: "#5f6470", textWrap: "pretty" }}>
            The link may be old or mistyped. Guest links open on the host’s own Tapry server, not on this site: if one brought you here, ask the host for a fresh one.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 8, marginTop: 6 }}>
            <a href="/" className="btn-dark-red" style={{ display: "inline-flex", height: 42, alignItems: "center", borderRadius: 10, background: "#0b0b0f", padding: "0 18px", fontSize: 15, fontWeight: 500, color: "#fff" }}>
              Back to home
            </a>
            <a href="/docs/" style={{ display: "inline-flex", height: 42, alignItems: "center", border: "1px solid #e4e4e7", borderRadius: 10, padding: "0 18px", fontSize: 15, fontWeight: 500 }}>
              Read the docs
            </a>
            <a href="/resources/#help" style={{ display: "inline-flex", height: 42, alignItems: "center", border: "1px solid #e4e4e7", borderRadius: 10, padding: "0 18px", fontSize: 15, fontWeight: 500 }}>
              Get help
            </a>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
