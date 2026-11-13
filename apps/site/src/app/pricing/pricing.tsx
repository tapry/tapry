"use client";

// The plans and the monthly/yearly switch. Self-hosted is the open-source release. The three
// Tapry Cloud plans are the ones in docs/plan/06-monetization.md (pricing v4: Creator, Studio,
// Team; yearly: 2 months free). With the hosted app's address set (HAS_CLOUD) each plan's button
// leads to its checkout there; without it the plans are labelled as planned.
import { useState } from "react";
import { WaitlistButton } from "@/components/waitlist";
import { checkoutUrl, CLOUD_NEWS, HAS_CLOUD, SIGNUP_URL } from "@/content/site";

type Plan = {
  name: string;
  price: string;
  per: string;
  desc: string;
  features: string[];
  highlight: boolean;
  tag: string | null;
  cta: { label: string; href: string } | "waitlist";
};

export function Plans() {
  const [yearly, setYearly] = useState(false);
  // Yearly: twelve months for the price of ten.
  const price = (m: number) => `$${(yearly ? m * 10 : m).toLocaleString("en-US")}`;
  const per = yearly ? "per year" : "per month";
  const tag = HAS_CLOUD ? null : "Planned";
  const lead = HAS_CLOUD ? "" : "Planned: ";
  const buy = (plan: "creator" | "studio" | "team", name: string): Plan["cta"] => (HAS_CLOUD ? { label: `Choose ${name}`, href: checkoutUrl(plan, yearly) } : "waitlist");

  const plans: Plan[] = [
    {
      name: "Self-hosted",
      price: "$0",
      per: "forever",
      desc: "Everything, on your server. Unlimited recordings and hours, up to 8 people in each.",
      cta: { label: "Read the setup guide", href: "/self-hosting/" },
      highlight: false,
      tag: null,
      features: [
        "Full-quality local recording for every guest",
        "Uploads to the bundled storage or your S3 bucket",
        "Per-person WAV + MP4, combined video",
        "Transcripts on your server (whisper.cpp)",
        "Community support on GitHub",
      ],
    },
    {
      name: "Cloud Creator",
      price: price(19),
      per,
      desc: `${lead}the same software on a server you don’t have to run, for one host.`.replace(/^t/, "T"),
      cta: buy("creator", "Creator"),
      highlight: true,
      tag,
      features: ["15 recording hours a month", "Finished files kept for 30 days", "Transcripts included", "Up to 8 people in a recording"],
    },
    {
      name: "Cloud Studio",
      price: price(39),
      per,
      desc: `${lead}for studios that record every week and share the work.`.replace(/^f/, "F"),
      cta: buy("studio", "Studio"),
      highlight: false,
      tag,
      features: ["40 recording hours a month", "3 seats", "Finished files kept for 60 days", "Transcripts included"],
    },
    {
      name: "Cloud Team",
      price: price(149),
      per,
      desc: `${lead}for newsrooms, research groups and media teams that must know where recordings are kept.`.replace(/^f/, "F"),
      cta: buy("team", "Team"),
      highlight: false,
      tag,
      features: ["80 recording hours a month", "5 seats", "Finished files kept for 90 days", "Hosted in the EU", "Email support"],
    },
  ];

  const tab = (on: boolean) => ({
    cursor: "pointer",
    border: 0,
    borderRadius: 4,
    padding: "6px 12px",
    fontWeight: 500,
    fontSize: 14,
    transition: "background .25s,color .25s",
    background: on ? "#0b0b0f" : "transparent",
    color: on ? "#fff" : "#0b0b0f",
  });

  return (
    <>
      <section style={{ background: "linear-gradient(180deg,#fbe3d8 0%,#fff 100%)", padding: "80px 32px 56px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 18 }}>
        <h1 className="rise" style={{ margin: 0, fontSize: "clamp(36px,4vw,52px)", lineHeight: 1.06, fontWeight: 500, letterSpacing: "-.03em" }}>
          Pricing
        </h1>
        <p className="rise" style={{ margin: 0, maxWidth: 580, fontSize: 18, lineHeight: 1.5, color: "#6b6b70", textWrap: "pretty", animationDelay: ".08s" }}>
          {HAS_CLOUD ? (
            <>
              Self-hosting is free, with no limits on recordings or hours. Tapry Cloud is the same software, hosted for you:{" "}
              <a href={SIGNUP_URL} style={{ color: "#0b0b0f", textDecoration: "underline", textUnderlineOffset: 3 }}>
                start free
              </a>{" "}
              with 2 recording hours a month, or choose a plan.
            </>
          ) : (
            `Self-hosting is free, with no limits on recordings or hours. Tapry Cloud, for people who’d rather not run a server, is planned and not open yet: to hear when it is, ${CLOUD_NEWS}.`
          )}
        </p>
        <div className="rise" role="group" aria-label="Billing period for the Tapry Cloud plans" style={{ display: "inline-flex", border: "1px solid #e6e6e9", borderRadius: 10, padding: 3, gap: 2, fontSize: 14, animationDelay: ".16s" }}>
          <button type="button" onClick={() => setYearly(false)} aria-pressed={!yearly} style={tab(!yearly)}>
            Monthly
          </button>
          <button type="button" onClick={() => setYearly(true)} aria-pressed={yearly} style={tab(yearly)}>
            Yearly <span style={{ color: yearly ? "rgba(255,255,255,.8)" : "#6b6b70" }}>· 2 months free</span>
          </button>
        </div>
      </section>

      <section style={{ padding: "0 32px 96px" }}>
        <div style={{ margin: "0 auto", display: "grid", maxWidth: 1180, gap: 16, gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,250px),1fr))" }}>
          {plans.map((p) => (
            <div key={p.name} className="rise" style={{ display: "flex", flexDirection: "column", gap: 22, border: `1px solid ${p.highlight ? "#0b0b0f" : "#ececef"}`, borderRadius: 20, background: "#fff", padding: 24 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 500 }}>{p.name}</h2>
                {p.tag && <span style={{ borderRadius: 4, background: "#c43c25", padding: "2px 8px", fontSize: 12, fontWeight: 500, color: "#fff", whiteSpace: "nowrap" }}>{p.tag}</span>}
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <span style={{ fontSize: 40, fontWeight: 500, letterSpacing: "-.03em", lineHeight: 1 }}>{p.price}</span>
                <span style={{ fontSize: 14, color: "#6b6b70" }}>{p.per}</span>
              </div>
              <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55, color: "#6b6b70", textWrap: "pretty", minHeight: 46 }}>{p.desc}</p>
              {p.cta === "waitlist" ? (
                <WaitlistButton dark={p.highlight} />
              ) : (
                <a
                  href={p.cta.href}
                  className="hv-85"
                  data-plan={p.name}
                  style={{ display: "inline-flex", height: 36, alignItems: "center", justifyContent: "center", borderRadius: 10, fontSize: 14, fontWeight: 500, transition: "background .2s", border: `1px solid ${p.highlight ? "#0b0b0f" : "#e6e6e9"}`, background: p.highlight ? "#0b0b0f" : "#fff", color: p.highlight ? "#fff" : "#0b0b0f" }}
                >
                  {p.cta.label}
                </a>
              )}
              <ul style={{ margin: 0, padding: "18px 0 0", listStyle: "none", display: "flex", flexDirection: "column", gap: 10, borderTop: "1px solid #ececef", fontSize: 14 }}>
                {p.features.map((f) => (
                  <li key={f} style={{ display: "flex", alignItems: "flex-start", gap: 10, color: "#3a3a3c" }}>
                    <svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#0b0b0f" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 3 }}>
                      <path d="M5 12l5 5l9-11" />
                    </svg>
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
