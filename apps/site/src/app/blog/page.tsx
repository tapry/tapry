import { BrandPanel, CtaRow, H1, HERO_BG, LEAD, OutlineBtn, Shell, TeamAvatar } from "@/components/ui";
import { postHref, posts } from "@/content/blog";
import { CHANGELOG_URL, pageMeta } from "@/content/site";

export const metadata = pageMeta({ title: "Blog · Tapry", description: "How Tapry works and why: notes from the project.", path: "/blog/" });

export default function BlogPage() {
  const [lead, ...rest] = posts;
  return (
    <Shell active="blog" label="Blog">
      <section style={{ background: HERO_BG, padding: "80px 32px 48px" }}>
        <div style={{ margin: "0 auto", display: "flex", maxWidth: 1180, flexDirection: "column", gap: 20 }}>
          <h1 className="rise" style={H1}>
            Blog
          </h1>
          <p className="rise" style={{ ...LEAD, maxWidth: 600, animationDelay: ".08s" }}>
            How Tapry works and why, from the project.
          </p>
        </div>
      </section>
      <section style={{ padding: "0 32px 96px" }}>
        <div style={{ margin: "0 auto", display: "flex", maxWidth: 1180, flexDirection: "column", gap: 16 }}>
          {lead && (
            <a href={postHref(lead)} className="card-hover fade4" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,400px),1fr))", border: "1px solid #ececef", borderRadius: 20, overflow: "hidden", color: "#0b0b0f", transition: "background .3s" }}>
              <span style={{ display: "block", aspectRatio: "16/10", background: "#0b0b0f", overflow: "hidden" }}>
                <BrandPanel />
              </span>
              <span style={{ display: "flex", flexDirection: "column", gap: 14, padding: 32, justifyContent: "center" }}>
                <span style={{ fontSize: 13, color: "#737378" }}>
                  {lead.date} · {lead.tag}
                </span>
                <span style={{ fontSize: "clamp(22px,2.2vw,28px)", fontWeight: 500, letterSpacing: "-.02em", lineHeight: 1.2, textWrap: "balance" }}>{lead.title}</span>
                <span style={{ fontSize: 16, lineHeight: 1.55, color: "#6b6b70", textWrap: "pretty" }}>{lead.summary}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, marginTop: 6 }}>
                  <TeamAvatar size={24} />
                  {lead.author}
                </span>
              </span>
            </a>
          )}
          {rest.length > 0 && (
            <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,300px),1fr))" }}>
              {rest.map((p) => (
                <a key={p.slug} href={postHref(p)} className="card-hover zoom fade4" style={{ display: "flex", flexDirection: "column", gap: 14, border: "1px solid #ececef", borderRadius: 20, overflow: "hidden", color: "#0b0b0f", transition: "background .3s" }}>
                  <span style={{ display: "block", aspectRatio: "16/9", background: "#0b0b0f", overflow: "hidden" }}>
                    <BrandPanel />
                  </span>
                  <span style={{ display: "flex", flexDirection: "column", gap: 10, padding: "4px 24px 24px" }}>
                    <span style={{ fontSize: 13, color: "#737378" }}>
                      {p.date} · {p.tag}
                    </span>
                    <span style={{ fontSize: 18, fontWeight: 500, letterSpacing: "-.015em", lineHeight: 1.3, textWrap: "balance" }}>{p.title}</span>
                    <span style={{ fontSize: 15, lineHeight: 1.55, color: "#6b6b70", textWrap: "pretty" }}>{p.summary}</span>
                    <span style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "#6b6b70", marginTop: 4 }}>
                      <TeamAvatar size={20} />
                      {p.author}
                    </span>
                  </span>
                </a>
              ))}
            </div>
          )}
        </div>
      </section>
      <CtaRow
        title={
          <span style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span>Release notes</span>
            <span style={{ fontSize: 15, letterSpacing: 0, color: "#6b6b70" }}>The changelog lists every release, with notes on upgrading.</span>
          </span>
        }
      >
        <OutlineBtn href={CHANGELOG_URL}>Read the changelog</OutlineBtn>
      </CtaRow>
    </Shell>
  );
}
