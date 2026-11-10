// The site's footer (TapryFooter). The landing page's version continues its closing gradient:
// no top padding and a rule above the columns.
import { hasCustomers } from "@/content/customers";
import { GITHUB } from "@/content/site";
import { LogoMark } from "./icons";

type Col = [title: string, links: Array<[string, string]>];

const company: Array<[string, string]> = [...(hasCustomers ? [["Customers", "/customers/"] as [string, string]] : []), ["Blog", "/blog/"], ["About", "/about/"]];
const developers: Array<[string, string]> = [
  ["Docs", "/docs/"],
  ["Self-hosting", "/self-hosting/"],
  ["GitHub", GITHUB],
];
const help: Col = ["Help", [["Support", "/resources/#help"], ["Changelog", "/resources/#changelog"], ["Free tools", "/tools/"], ["Privacy", "/legal/#privacy"], ["Terms", "/legal/#terms"]]];

const PAGE_COLS: Col[] = [["Product", [["Studio", "/#capture"], ["Use cases", "/use-cases/"], ["Pricing", "/pricing/"]]], ["Company", company], ["Developers", developers], help];

const LANDING_COLS: Col[] = [["Product", [["Studio", "#capture"], ["Storage", "#formats"], ["Use cases", "/use-cases/"], ["Pricing", "/pricing/"]]], ["Company", company], ["Developers", developers], help];

export function Footer({ landing = false }: { landing?: boolean }) {
  const cols = landing ? LANDING_COLS : PAGE_COLS;
  return (
    <footer className="on-brand" style={{ background: "#a83a1e", color: "#fff", padding: landing ? "0 28px 40px" : "56px 28px 40px" }}>
      <div
        style={{
          margin: "0 auto",
          display: "grid",
          maxWidth: 1180,
          gap: 32,
          fontSize: 14,
          gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))",
          ...(landing ? { borderTop: "1px solid rgba(255,255,255,.25)", paddingTop: 40 } : {}),
        }}
      >
        <a href={landing ? "#top" : "/"} className="foot-link" style={{ display: "flex", alignItems: "center", gap: 9, alignSelf: "start", fontSize: 19, fontWeight: 600, letterSpacing: "-.03em", color: "#fff" }}>
          <LogoMark size={22} reversed />
          Tapry
        </a>
        {cols.map(([title, links]) => (
          <nav key={title} aria-label={title} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <span style={{ color: "rgba(255,255,255,.88)" }}>{title}</span>
            {links.map(([label, href]) => (
              <a key={label} href={href} className="foot-link" style={{ color: "#fff" }}>
                {label}
              </a>
            ))}
          </nav>
        ))}
      </div>
      <div style={{ margin: "40px auto 0", maxWidth: 1180, fontSize: 13, color: "rgba(255,255,255,.88)", ...(landing ? {} : { borderTop: "1px solid rgba(255,255,255,.25)", paddingTop: 20 }) }}>© Tapry contributors 2026 · AGPL-3.0</div>
    </footer>
  );
}
