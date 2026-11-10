// One docs page: the sidebar, the page, and "On this page". Every docs page is its own address
// (/docs/storage/), so all of them are in the static files and headings are plain #anchors.
import type { Metadata } from "next";
import { CODE_FONT, Shell } from "@/components/ui";
import { DOC_ORDER, DOCS, docHref, slug, type DocPage } from "@/content/docs";
import { DOCS_EDIT_URL, pageMeta } from "@/content/site";
import { DocsNav } from "./docs-nav";

const flat = DOC_ORDER.flatMap(([, ids]) => ids).map((id) => DOCS.find((d) => d.id === id)!);

export function docMeta(d: DocPage): Metadata {
  const first = d.id === DOCS[0]!.id;
  return pageMeta({
    title: first ? "Docs: set up, record, store and transcribe · Tapry" : `${d.title} · Tapry docs`,
    description: first ? "How to self-host Tapry, how recording and alignment work, producer alerts, storage, output files, transcripts and operating your server." : `${d.lede} ${d.section}, in the Tapry docs.`,
    path: docHref(d),
  });
}

export function DocView({ doc: d }: { doc: DocPage }) {
  const idx = flat.indexOf(d);
  const prev = flat[idx - 1];
  const next = flat[idx + 1];
  const toc = d.blocks.flatMap((b) => (b.kind === "h" ? [{ id: slug(b.text), text: b.text }] : []));

  return (
    <Shell active="docs" label="Docs">
      <div className="docs-shell" style={{ margin: "0 auto", display: "grid", maxWidth: 1180, gap: 48, padding: "40px 32px 96px", fontSize: 15 }}>
        <DocsNav current={d.id} />

        <article style={{ display: "flex", minWidth: 0, flexDirection: "column", gap: 28 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <span style={{ display: "flex", gap: 8, fontSize: 13, color: "#737378" }}>
              <span>{d.section}</span>
              <span aria-hidden="true" style={{ color: "#c9c9cf" }}>
                /
              </span>
              <span style={{ color: "#0b0b0f" }}>{d.title}</span>
            </span>
            <h1 style={{ margin: 0, fontSize: 36, fontWeight: 500, letterSpacing: "-.03em", lineHeight: 1.1 }}>{d.title}</h1>
            <p style={{ margin: 0, fontSize: 17, lineHeight: 1.55, color: "#6b6b70", textWrap: "pretty" }}>{d.lede}</p>
          </div>
          {d.blocks.map((b, i) => {
            switch (b.kind) {
              case "h":
                return (
                  <h2 key={i} id={slug(b.text)} style={{ margin: "16px 0 0", fontSize: 22, fontWeight: 500, letterSpacing: "-.02em", borderTop: "1px solid #ececef", paddingTop: 28, scrollMarginTop: 80 }}>
                    {b.text}
                  </h2>
                );
              case "p":
                return (
                  <p key={i} style={{ margin: 0, lineHeight: 1.65, color: "#3a3a3c", textWrap: "pretty" }}>
                    {b.text}
                  </p>
                );
              case "code":
                return (
                  <pre key={i} tabIndex={0} style={{ margin: 0, overflow: "auto", border: "1px solid #ececef", borderRadius: 12, background: "#f7f7f8", padding: "14px 16px", fontFamily: CODE_FONT, fontSize: 13, lineHeight: 1.65, color: "#0b0b0f" }}>
                    {b.text}
                  </pre>
                );
              case "note":
                return (
                  <div key={i} role="note" style={{ border: "1px solid #e6e6e9", borderRadius: 12, padding: "12px 16px", fontSize: 14, lineHeight: 1.55, color: "#3a3a3c", background: "#fafafa" }}>
                    {b.text}
                  </div>
                );
              case "table":
                return (
                  <div key={i} style={{ display: "flex", flexDirection: "column", fontSize: 14, borderTop: "1px solid #0b0b0f" }}>
                    {b.rows.map(([k, v]) => (
                      <div key={k} className="doc-row" style={{ borderBottom: "1px solid #f1f1f3", padding: "10px 0" }}>
                        <code style={{ fontFamily: CODE_FONT, fontSize: 13, overflowWrap: "anywhere" }}>{k}</code>
                        <span style={{ color: "#3a3a3c" }}>{v}</span>
                      </div>
                    ))}
                  </div>
                );
            }
          })}
          <nav aria-label="Previous and next page" style={{ display: "flex", justifyContent: "space-between", gap: 16, borderTop: "1px solid #ececef", paddingTop: 24, fontSize: 14, flexWrap: "wrap" }}>
            {prev ? (
              <a href={docHref(prev)} className="docs-pager" style={{ ...pager, alignItems: "flex-start", textAlign: "left" }}>
                <span style={{ fontSize: 12, color: "#737378" }}>Previous</span>
                {prev.title}
              </a>
            ) : (
              <span />
            )}
            {next && (
              <a href={docHref(next)} className="docs-pager" style={{ ...pager, alignItems: "flex-end", textAlign: "right" }}>
                <span style={{ fontSize: 12, color: "#737378" }}>Next</span>
                {next.title}
              </a>
            )}
          </nav>
        </article>

        <aside className="docs-toc" aria-label="On this page" style={{ position: "sticky", top: 80, alignSelf: "start", display: "flex", flexDirection: "column", gap: 10, fontSize: 13 }}>
          <span style={{ color: "#737378" }}>On this page</span>
          {toc.map((t) => (
            <a key={t.id} href={`#${t.id}`} className="toc-link" style={{ color: "#3a3a3c", borderLeft: "1px solid #ececef", padding: "2px 10px" }}>
              {t.text}
            </a>
          ))}
          <a href={DOCS_EDIT_URL} style={{ marginTop: 14, color: "#6b6b70" }}>
            Edit on GitHub →
          </a>
        </aside>
      </div>
    </Shell>
  );
}

const pager = { border: "1px solid #e6e6e9", borderRadius: 10, background: "#fff", padding: "8px 12px", fontSize: 14, color: "#0b0b0f", display: "flex", flexDirection: "column", gap: 2 } as const;
