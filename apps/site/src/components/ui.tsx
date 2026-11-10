// Pieces the inner pages share (the designs repeat them inline).
import type { CSSProperties, ReactNode } from "react";
import { Footer } from "./footer";
import { Nav, type NavId } from "./nav";

export function Shell({ active, children, label }: { active?: NavId; children: ReactNode; label?: string }) {
  return (
    <div data-screen-label={label} style={{ minHeight: "100vh", background: "#fff" }}>
      <a href="#main" className="skip">
        Skip to content
      </a>
      <Nav active={active} />
      <main id="main">{children}</main>
      <Footer />
    </div>
  );
}

export const H2: CSSProperties = { margin: 0, fontSize: "clamp(26px,2.6vw,32px)", fontWeight: 500, letterSpacing: "-.03em" };
export const H1: CSSProperties = { margin: 0, fontSize: "clamp(36px,4vw,52px)", lineHeight: 1.06, fontWeight: 500, letterSpacing: "-.03em" };
export const LEAD: CSSProperties = { margin: 0, fontSize: 18, lineHeight: 1.5, color: "#6b6b70", textWrap: "pretty" };
export const HERO_BG = "linear-gradient(180deg,#fbe3d8 0%,#fff 100%)";

/** A bordered section with the 1180px column. */
export function Section({ id, children, style, innerStyle }: { id?: string; children: ReactNode; style?: CSSProperties; innerStyle?: CSSProperties }) {
  return (
    <section id={id} style={{ borderTop: "1px solid #ececef", padding: "96px 32px", ...style }}>
      <div style={{ margin: "0 auto", maxWidth: 1180, ...innerStyle }}>{children}</div>
    </section>
  );
}

/** Section title with the designs' small "Kicker 1.0" marker on the right. */
export function SectionHead({ title, kicker, num }: { title: ReactNode; kicker?: string; num?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
      <h2 style={H2}>{title}</h2>
      {kicker && (
        <span style={{ display: "flex", gap: 16, fontSize: 14, color: "#737378" }}>
          <span>{kicker}</span>
          <span style={{ color: "#0b0b0f" }}>{num}</span>
        </span>
      )}
    </div>
  );
}

export function DarkBtn({ href, children, style }: { href: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <a href={href} className="btn-dark" style={{ display: "inline-flex", height: 36, alignItems: "center", borderRadius: 10, background: "#0b0b0f", padding: "0 14px", fontSize: 14, fontWeight: 500, color: "#fff", whiteSpace: "nowrap", ...style }}>
      {children}
    </a>
  );
}

export function OutlineBtn({ href, children, style }: { href: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <a href={href} className="btn-outline" style={{ display: "inline-flex", height: 36, alignItems: "center", border: "1px solid #e6e6e9", borderRadius: 10, padding: "0 14px", fontSize: 14, fontWeight: 500, color: "#0b0b0f", whiteSpace: "nowrap", ...style }}>
      {children}
    </a>
  );
}

export function Chip({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className="chip" style={{ borderRadius: 10, background: "#f1f1f3", padding: "7px 14px", fontSize: 14, fontWeight: 500, color: "#0b0b0f" }}>
      {children}
    </a>
  );
}

/** A closing row: a heading and buttons. */
export function CtaRow({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <Section innerStyle={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24, flexWrap: "wrap" }}>
      <h2 style={{ ...H2, textWrap: "balance" }}>{title}</h2>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{children}</div>
    </Section>
  );
}

/**
 * Stands in for a photo where the designs show a person who isn't real (blog posts by the team,
 * the About page): the Tapry mark over the brand gradient, with quiet level bars.
 */
export function BrandPanel({ style, bars = true }: { style?: CSSProperties; bars?: boolean }) {
  return (
    <span aria-hidden="true" style={{ position: "relative", display: "grid", placeItems: "center", width: "100%", height: "100%", overflow: "hidden", background: "linear-gradient(160deg,#7d2613 0%,#a83a1e 38%,#d2603c 70%,#f3b9a0 100%)", ...style }}>
      <span style={{ position: "absolute", left: "-10%", top: "20%", width: "60%", height: "60%", borderRadius: "50%", background: "rgba(255,255,255,.22)", filter: "blur(50px)", animation: "drift 26s ease-in-out infinite" }} />
      <span style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 18, color: "#fff" }}>
        <svg viewBox="0 0 32 32" width={64} height={64}>
          <rect width="32" height="32" rx="8" fill="#fff" />
          <path d="M8 9v4M12 9v7.5M16 9v15M20 9v7.5M24 9v4" fill="none" stroke="#c43c25" strokeWidth={2.6} strokeLinecap="round" />
        </svg>
        {bars && (
          <span style={{ display: "flex", height: 28, alignItems: "center", gap: 4 }}>
            {Array.from({ length: 15 }, (_, k) => (
              <span key={k} style={{ width: 3, height: 28, borderRadius: 2, background: "rgba(255,255,255,.85)", transform: "scaleY(.25)", animation: `eq ${(0.5 + ((k * 37) % 10) / 20).toFixed(2)}s ease-in-out ${(-k * 0.07).toFixed(2)}s infinite` }} />
            ))}
          </span>
        )}
      </span>
    </span>
  );
}

/** Code blocks use the system monospace, as in the designs. */
export const CODE_FONT = "ui-monospace,SFMono-Regular,Menlo,monospace";

/** The author mark for posts by the team: the Tapry logo instead of a person's photo. */
export function TeamAvatar({ size }: { size: number }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32" width={size} height={size} style={{ flexShrink: 0 }}>
      <rect width="32" height="32" rx="8" fill="#e8553d" />
      <path d="M8 9v4M12 9v7.5M16 9v15M20 9v7.5M24 9v4" fill="none" stroke="#fff" strokeWidth={size <= 16 ? 3 : 2.6} strokeLinecap="round" />
    </svg>
  );
}
