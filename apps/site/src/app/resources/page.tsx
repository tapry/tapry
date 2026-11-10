import { BrandPanel, Chip, DarkBtn, H1, H2, HERO_BG, LEAD, OutlineBtn, SectionHead, Shell } from "@/components/ui";
import { postHref, posts } from "@/content/blog";
import { releases } from "@/content/changelog";
import { BROWSER_REPORT_URL, BUG_REPORT_URL, CHANGELOG_URL, CONTRIBUTING_URL, GITHUB, SECURITY_URL, HAS_SPEED_TEST, pageMeta } from "@/content/site";

export const metadata = pageMeta({
  title: `Resources: blog, free ${HAS_SPEED_TEST ? "tools" : "mic test"}, changelog and help · Tapry`,
  description: `Writing about Tapry, the free mic ${HAS_SPEED_TEST ? "and upload-speed tests" : "and camera test"}, every release, the project behind it and where to get help.`,
  path: "/resources/",
});

const card = { display: "flex", flexDirection: "column", border: "1px solid #ececef", borderRadius: 20, color: "#0b0b0f", transition: "background .3s" } as const;

export default function ResourcesPage() {
  const tools = [
    { href: "/mic-test/", title: "Mic & camera test", body: "Check your level, hear yourself back and see your camera’s real resolution. Send it to guests before any call, Tapry or not.", cta: "Open the test →" },
    ...(HAS_SPEED_TEST
      ? [{ href: "/upload-speed-test/", title: "Upload speed test", body: "Measures the direction that matters for recording and tells you whether sound only, 720p or 1080p will keep up.", cta: "Run the test →" }]
      : []),
  ];
  const help = [
    { href: "/docs/", title: "Documentation", body: "Setup, recording, storage, transcripts, operating." },
    { href: BUG_REPORT_URL, title: "Report a bug", body: "Issues on GitHub, with a template." },
    { href: BROWSER_REPORT_URL, title: "Report a browser", body: "A browser that doesn’t work? It feeds the tested list." },
    { href: SECURITY_URL, title: "Security", body: "How to report a vulnerability privately." },
  ];

  return (
    <Shell active="resources" label="Resources">
      <section style={{ background: HERO_BG, padding: "80px 32px 48px" }}>
        <div style={{ margin: "0 auto", display: "flex", maxWidth: 1180, flexDirection: "column", gap: 20 }}>
          <h1 className="rise" style={H1}>
            Resources
          </h1>
          <p className="rise" style={{ ...LEAD, maxWidth: 600, animationDelay: ".08s" }}>
            Writing, free tools, release notes, the project behind Tapry and where to get help.
          </p>
          <div className="rise" style={{ display: "flex", gap: 4, flexWrap: "wrap", animationDelay: ".16s" }}>
            <Chip href="#blog">Blog</Chip>
            <Chip href="#tools">Free tools</Chip>
            <Chip href="#changelog">Changelog</Chip>
            <Chip href="#company">Company</Chip>
            <Chip href="#help">Help</Chip>
          </div>
        </div>
      </section>

      <section id="blog" style={sec}>
        <div style={col}>
          <SectionHead title="Blog" kicker="Resources" num="1.0" />
          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,300px),1fr))" }}>
            {posts.slice(0, 3).map((p) => (
              <a key={p.slug} href={postHref(p)} className="card-hover zoom" style={{ ...card, gap: 14, overflow: "hidden", maxWidth: posts.length === 1 ? 560 : undefined }}>
                <span style={{ display: "block", aspectRatio: "16/9", background: "#0b0b0f", overflow: "hidden" }}>
                  <BrandPanel />
                </span>
                <span style={{ display: "flex", flexDirection: "column", gap: 10, padding: "4px 24px 24px" }}>
                  <span style={{ fontSize: 13, color: "#737378" }}>
                    {p.date} · {p.tag}
                  </span>
                  <span style={{ fontSize: 18, fontWeight: 500, letterSpacing: "-.015em", lineHeight: 1.3, textWrap: "balance" }}>{p.title}</span>
                  <span style={{ fontSize: 15, lineHeight: 1.55, color: "#6b6b70", textWrap: "pretty" }}>{p.summary}</span>
                </span>
              </a>
            ))}
          </div>
        </div>
      </section>

      <section id="tools" style={sec}>
        <div style={col}>
          <SectionHead title="Free tools" kicker="Resources" num="2.0" />
          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,400px),1fr))" }}>
            {tools.map((t) => (
              <a key={t.href} href={t.href} className="card-hover" style={{ ...card, gap: 12, padding: 28 }}>
                <span style={{ fontSize: 13, color: "#737378" }}>No sign-up</span>
                <span style={{ fontSize: 20, fontWeight: 500, letterSpacing: "-.02em" }}>{t.title}</span>
                <span style={{ fontSize: 15, lineHeight: 1.55, color: "#6b6b70" }}>{t.body}</span>
                <span style={{ marginTop: 8, fontSize: 14, fontWeight: 500 }}>{t.cta}</span>
              </a>
            ))}
          </div>
        </div>
      </section>

      <section id="changelog" style={sec}>
        <div style={{ margin: "0 auto", display: "grid", maxWidth: 1180, gap: "40px 64px", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,360px),1fr))", alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <h2 style={H2}>Changelog</h2>
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55, color: "#6b6b70" }}>Every release, with what changed for hosts, guests and the people running the server.</p>
            <a href={CHANGELOG_URL} style={{ fontSize: 14, fontWeight: 500 }}>
              Full changelog on GitHub →
            </a>
          </div>
          <div style={{ display: "flex", flexDirection: "column", borderTop: "1px solid #ececef" }}>
            {releases.map((r) => (
              <div key={r.version} style={{ display: "grid", gridTemplateColumns: "90px minmax(0,1fr)", gap: 16, borderBottom: "1px solid #ececef", padding: "18px 0" }}>
                <span style={{ fontSize: 13, color: "#737378", fontVariantNumeric: "tabular-nums", paddingTop: 2 }}>{r.version}</span>
                <span style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 16, fontWeight: 500 }}>{r.title}</span>
                  <span style={{ fontSize: 15, lineHeight: 1.55, color: "#6b6b70" }}>{r.body}</span>
                  {r.date && <span style={{ fontSize: 13, color: "#737378" }}>{r.date}</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="company" style={sec}>
        <div style={{ margin: "0 auto", display: "grid", maxWidth: 1180, gap: "40px 64px", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,420px),1fr))" }}>
          <h2 style={{ ...H2, lineHeight: 1.2, textWrap: "balance" }}>An open-source studio you can read to the last line</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 18, fontSize: 17, lineHeight: 1.55, color: "#3a3a3c", textWrap: "pretty" }}>
            <p style={{ margin: 0 }}>Tapry, formerly OpenTake, is an open-source remote recording studio: guests join by link, everyone is recorded on their own computer, and the files land on a server you run.</p>
            <p style={{ margin: 0 }}>
              The server is AGPL-3.0 so improvements stay shared; the recorder core is MIT so anyone can build on it. Tapry Cloud, the same software without running a server, is planned. <a href="/about/" style={{ textDecoration: "underline", textUnderlineOffset: 3, textDecorationColor: "#e8553d" }}>About Tapry</a>
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <DarkBtn href={GITHUB}>GitHub</DarkBtn>
              <OutlineBtn href={CONTRIBUTING_URL}>Contribute</OutlineBtn>
            </div>
          </div>
        </div>
      </section>

      <section id="help" style={sec}>
        <div style={col}>
          <SectionHead title="Help" kicker="Resources" num="3.0" />
          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,260px),1fr))" }}>
            {help.map((h) => (
              <a key={h.title} href={h.href} className="card-hover" style={{ ...card, gap: 8, padding: 24 }}>
                <span style={{ fontSize: 17, fontWeight: 500 }}>{h.title}</span>
                <span style={{ fontSize: 14, lineHeight: 1.55, color: "#6b6b70" }}>{h.body}</span>
              </a>
            ))}
          </div>
        </div>
      </section>
    </Shell>
  );
}

const sec = { borderTop: "1px solid #ececef", padding: "96px 32px", scrollMarginTop: 64 } as const;
const col = { margin: "0 auto", display: "flex", maxWidth: 1180, flexDirection: "column", gap: 40 } as const;
