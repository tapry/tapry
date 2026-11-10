"use client";

// The docs' sidebar: every page is a real link (it works without script, Back goes back), and the
// search box filters the list by title and text (⌘K / Ctrl+K).
import { useEffect, useMemo, useRef, useState } from "react";
import { DOC_ORDER, DOCS, docHref, type DocPage } from "@/content/docs";

const byId = new Map(DOCS.map((d) => [d.id, d]));

function text(d: DocPage) {
  return [d.title, d.lede, ...d.blocks.map((b) => (b.kind === "table" ? b.rows.flat().join(" ") : b.text))].join(" ").toLowerCase();
}

export function DocsNav({ current }: { current: string }) {
  const [query, setQuery] = useState("");
  // Shown as "Ctrl K" until we know it's a Mac: the server can't tell.
  const [mac, setMac] = useState(false);
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
    // Links from before each page had its own address: /docs/#storage, /docs/#storage/your-own-bucket.
    const [id, heading] = location.hash.slice(1).split("/");
    if (id && id !== current && byId.has(id) && !document.getElementById(id)) {
      location.replace(docHref({ id }) + (heading ? `#${heading}` : ""));
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current]);

  const q = query.trim().toLowerCase();
  const sections = useMemo(
    () => DOC_ORDER.map(([title, ids]) => ({ title, ids: ids.filter((id) => !q || text(byId.get(id)!).includes(q)) })).filter((s) => s.ids.length > 0),
    [q],
  );

  return (
    <nav className="docs-nav" aria-label="Docs" style={{ position: "sticky", top: 80, alignSelf: "start", display: "flex", flexDirection: "column", gap: 18, fontSize: 14 }}>
      <label className="docs-search" style={{ display: "flex", alignItems: "center", gap: 8, border: "1px solid #e6e6e9", borderRadius: 10, padding: "7px 10px", color: "#737378" }}>
        <svg aria-hidden="true" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
        <input
          ref={search}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search docs"
          aria-label="Search docs"
          style={{ flex: 1, minWidth: 0, border: 0, outline: 0, padding: 0, background: "transparent", fontSize: 14, color: "#0b0b0f" }}
        />
        <span aria-hidden="true" style={{ marginLeft: "auto", fontSize: 12, border: "1px solid #e6e6e9", borderRadius: 4, padding: "0 5px", whiteSpace: "nowrap" }}>
          {mac ? "⌘K" : "Ctrl K"}
        </span>
      </label>
      <span role="status" style={{ padding: "0 8px", color: "#6b6b70" }} hidden={sections.length > 0}>
        {sections.length === 0 ? `Nothing matches “${query}”.` : ""}
      </span>
      {sections.map((s) => (
        <div key={s.title} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ padding: "4px 8px", fontSize: 12, color: "#737378" }}>{s.title}</span>
          {s.ids.map((id) => (
            <a key={id} href={docHref({ id })} className="docs-item" aria-current={current === id ? "page" : undefined} style={{ borderRadius: 10, padding: "6px 8px", fontSize: 14, color: "#0b0b0f", transition: "background .2s" }}>
              {byId.get(id)!.title}
            </a>
          ))}
        </div>
      ))}
    </nav>
  );
}
