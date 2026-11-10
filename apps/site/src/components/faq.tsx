"use client";

// The questions accordion from the Pricing design: one open at a time, the first open to start.
// Each question is a heading holding a button; its answer is a separate region, hidden from
// everyone (not just clipped) while closed.
import { useId, useState } from "react";

export function Faq({ items, initial = 0 }: { items: Array<[string, string]>; initial?: number }) {
  const [open, setOpen] = useState(initial);
  const base = useId();
  return (
    <div style={{ display: "flex", flexDirection: "column", borderTop: "1px solid #ececef" }}>
      {items.map(([q, a], i) => {
        const on = open === i;
        return (
          <div key={q} style={{ borderBottom: "1px solid #ececef", padding: "18px 0", color: "#0b0b0f" }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 500 }}>
              <button type="button" id={`${base}-q${i}`} className="fold-btn" onClick={() => setOpen(on ? -1 : i)} aria-expanded={on} aria-controls={`${base}-a${i}`}>
                <span>{q}</span>
                <span aria-hidden="true" style={{ display: "grid", width: 20, height: 20, flexShrink: 0, placeItems: "center", color: "#737378", transition: "transform .4s cubic-bezier(.2,.7,.2,1)", transform: on ? "rotate(45deg)" : "none" }}>
                  +
                </span>
              </button>
            </h3>
            <div id={`${base}-a${i}`} role="region" aria-labelledby={`${base}-q${i}`} className="fold" data-open={on ? "" : undefined}>
              <div>
                <p style={{ margin: 0, paddingTop: 10, fontSize: 15, lineHeight: 1.6, color: "#6b6b70", textWrap: "pretty" }}>{a}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
