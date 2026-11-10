"use client";

// The site's header (TapryNav). On the landing page it sits over the hero, clear with white
// text, and turns white once the page scrolls (`overlay`; the colours are in site.css). Below
// 900px the links move into a menu that a button opens.
import { useEffect, useRef, useState } from "react";
import { hasCustomers } from "@/content/customers";
import { GET_STARTED, GITHUB } from "@/content/site";
import { LogoMark } from "./icons";

export type NavId = "home" | "solutions" | "customers" | "docs" | "resources" | "self-hosting" | "pricing" | "blog" | "company";

const LINKS: Array<[label: string, href: string, id: NavId]> = [
  ["Product", "/#capture", "home"],
  ["Use Cases", "/use-cases/", "solutions"],
  ...(hasCustomers ? [["Customers", "/customers/", "customers"] as [string, string, NavId]] : []),
  ["Docs", "/docs/", "docs"],
  ["Resources", "/resources/", "resources"],
  ["Pricing", "/pricing/", "pricing"],
];

// Runs as the header is parsed, before the page's own script: a page opened part-way down
// (/#capture, or a reload) never shows white text on a white section.
const SCROLL_SCRIPT =
  "(function(){var h=document.currentScript.parentElement;function f(){h.toggleAttribute('data-scrolled',window.scrollY>40)}f();window.addEventListener('scroll',f,{passive:true})})()";

export function Nav({ active, overlay = false }: { active?: NavId; overlay?: boolean }) {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      toggle.current?.focus();
    };
    // Wider than the menu's breakpoint, the links are in the header again.
    const wide = window.matchMedia("(min-width: 900px)");
    const onWide = () => wide.matches && setOpen(false);
    window.addEventListener("keydown", onKey);
    wide.addEventListener("change", onWide);
    return () => {
      window.removeEventListener("keydown", onKey);
      wide.removeEventListener("change", onWide);
    };
  }, [open]);

  const links = LINKS.map(([label, href, id]) => {
    const on = active === id || (id === "resources" && active === "self-hosting");
    return { label, href: overlay && href === "/#capture" ? "#capture" : href, on };
  });

  return (
    <header className={overlay ? "site-nav site-nav-overlay" : "site-nav"} data-open={open ? "" : undefined} suppressHydrationWarning>
      <div style={inner}>
        <a href={overlay ? "#top" : "/"} className="nav-brand" style={brand} aria-label={overlay ? "Tapry, back to top" : "Tapry, home"}>
          <LogoMark />
          Tapry
        </a>
        <nav className="nav-links" aria-label="Main" style={{ gap: 30, fontSize: 15 }}>
          {links.map((l) => (
            <a key={l.label} href={l.href} aria-current={l.on ? "page" : undefined}>
              {l.label}
            </a>
          ))}
        </nav>
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 15 }}>
          <a href={GITHUB} className="nav-github">
            GitHub
          </a>
          <a href={GET_STARTED} className="nav-cta" style={{ display: "inline-flex", height: 38, alignItems: "center", borderRadius: 10, padding: "0 16px", fontWeight: 500, whiteSpace: "nowrap" }}>
            Get Started
          </a>
          <button ref={toggle} type="button" className="nav-toggle" aria-expanded={open} aria-controls="site-menu" aria-label="Menu" onClick={() => setOpen((o) => !o)}>
            <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d={open ? "M6 6l12 12M18 6L6 18" : "M4 7h16M4 12h16M4 17h16"} />
            </svg>
          </button>
        </div>
      </div>
      <nav id="site-menu" className="nav-menu" aria-label="Menu" hidden={!open}>
        {links.map((l) => (
          <a key={l.label} href={l.href} aria-current={l.on ? "page" : undefined} onClick={() => setOpen(false)}>
            {l.label}
          </a>
        ))}
        <a href={GITHUB}>GitHub</a>
      </nav>
      {overlay && <script dangerouslySetInnerHTML={{ __html: SCROLL_SCRIPT }} />}
    </header>
  );
}

const inner = { margin: "0 auto", display: "flex", maxWidth: 1180, height: 64, alignItems: "center", justifyContent: "space-between", gap: 24, padding: "0 28px" } as const;
const brand = { display: "flex", alignItems: "center", gap: 9, fontSize: 21, fontWeight: 600, letterSpacing: "-.03em" } as const;
