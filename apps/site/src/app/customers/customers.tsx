"use client";

// The Customers page body (the Customers design): tag filters, featured quotes, story cards.
// Rendered only when src/content/customers.ts has stories.
import { useState } from "react";
import { customers } from "@/content/customers";

export function CustomerStories() {
  const tags = [...new Set(customers.map((c) => c.tag))];
  const [f, setF] = useState("All");
  const cards = customers.filter((c) => f === "All" || c.tag === f);
  const featured = customers.filter((c) => c.featured).slice(0, 2);

  return (
    <section style={{ padding: "0 32px 96px" }}>
      <div style={{ margin: "0 auto", display: "flex", maxWidth: 1180, flexDirection: "column", gap: 32 }}>
        {tags.length > 1 && (
          <div className="rise" style={{ display: "flex", gap: 4, flexWrap: "wrap", animationDelay: ".16s" }}>
            {["All", ...tags].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setF(n)}
                aria-pressed={f === n}
                style={{ cursor: "pointer", border: 0, borderRadius: 10, padding: "7px 14px", fontSize: 14, fontWeight: 500, transition: "background .3s,color .3s", background: f === n ? "#0b0b0f" : "#f1f1f3", color: f === n ? "#fff" : "#0b0b0f" }}
              >
                {n}
              </button>
            ))}
          </div>
        )}
        {featured.length > 0 && (
          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,440px),1fr))" }}>
            {featured.map((c) => (
              <figure key={c.slug} className="zoom fade4" style={{ position: "relative", margin: 0, aspectRatio: "16/10", overflow: "hidden", borderRadius: 20, background: "#0b0b0f" }}>
                <img src={c.photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center 20%", opacity: 0.85 }} />
                <figcaption style={{ position: "absolute", inset: "auto 0 0 0", display: "flex", flexDirection: "column", gap: 16, padding: 28, background: "linear-gradient(180deg,transparent,rgba(0,0,0,.65))", color: "#fff" }}>
                  <span style={{ fontSize: 14, fontWeight: 500 }}>{c.org}</span>
                  <blockquote style={{ margin: 0, fontSize: "clamp(17px,1.5vw,20px)", lineHeight: 1.4, letterSpacing: "-.01em", textWrap: "pretty" }}>“{c.featured!.quote}”</blockquote>
                  <span style={{ display: "flex", flexDirection: "column", fontSize: 14 }}>
                    <span style={{ fontWeight: 500 }}>{c.name}</span>
                    <span style={{ color: "rgba(255,255,255,.75)" }}>{c.role}</span>
                  </span>
                </figcaption>
              </figure>
            ))}
          </div>
        )}
        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,300px),1fr))" }}>
          {cards.map((c) => (
            <a key={c.slug} href={`/customers/${c.slug}/`} className="card-hover fade4" style={{ display: "flex", flexDirection: "column", gap: 20, border: "1px solid #ececef", borderRadius: 20, background: "#fff", padding: 28, color: "#0b0b0f", transition: "background .3s" }}>
              <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 14, fontWeight: 500 }}>{c.org}</span>
                <span style={{ borderRadius: 4, background: "#f1f1f3", padding: "2px 8px", fontSize: 12, color: "#3a3a3c" }}>{c.tag}</span>
              </span>
              <span style={{ fontSize: 16, lineHeight: 1.5, textWrap: "pretty" }}>“{c.quote}”</span>
              <span style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 10, fontSize: 14 }}>
                <img src={c.photo} alt="" style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover", objectPosition: "center 30%" }} />
                <span style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontWeight: 500 }}>{c.name}</span>
                  <span style={{ color: "#6b6b70" }}>{c.role}</span>
                </span>
              </span>
              <span style={{ display: "flex", gap: 16, borderTop: "1px solid #f1f1f3", paddingTop: 14, fontSize: 13, color: "#6b6b70" }}>
                {c.stats.map(([v, k]) => (
                  <span key={k}>
                    <span style={{ color: "#0b0b0f", fontWeight: 500 }}>{v}</span> {k}
                  </span>
                ))}
              </span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
