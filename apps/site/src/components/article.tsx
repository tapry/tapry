// A blog post or a customer story (the Article design). Posts by the team show the Tapry mark
// where the design has a person's photo.
import type { ArticleBlock } from "@/content/blog";
import { GET_STARTED } from "@/content/site";
import type { NavId } from "./nav";
import { BrandPanel, Shell, TeamAvatar } from "./ui";

export function Article({
  nav,
  back,
  tag,
  title,
  lede,
  author,
  meta,
  photo,
  stats = [],
  blocks,
}: {
  nav: NavId;
  back: [label: string, href: string];
  tag: string;
  title: string;
  lede: string;
  author: string;
  meta: string;
  /** A real person's photo (customer stories); none for posts by the team. */
  photo?: string;
  stats?: Array<[string, string]>;
  blocks: ArticleBlock[];
}) {
  return (
    <Shell active={nav} label="Article">
      <article>
        <header style={{ background: "linear-gradient(180deg,#fbe3d8 0%,#fff 100%)", padding: "72px 28px 36px" }}>
          <div className="rise" style={{ margin: "0 auto", display: "flex", maxWidth: 760, flexDirection: "column", gap: 18, animationDuration: ".6s" }}>
            <a href={back[1]} style={{ alignSelf: "flex-start", fontSize: 14, color: "#5f6470" }}>
              ← {back[0]}
            </a>
            <span style={{ alignSelf: "flex-start", borderRadius: 6, background: "#fff", padding: "3px 9px", fontSize: 12.5, fontWeight: 500, color: "#c43c25" }}>{tag}</span>
            <h1 style={{ margin: 0, fontSize: "clamp(32px,4vw,48px)", lineHeight: 1.08, fontWeight: 500, letterSpacing: "-.03em", textWrap: "balance" }}>{title}</h1>
            <p style={{ margin: 0, fontSize: 19, lineHeight: 1.5, color: "#3f3f46", textWrap: "pretty" }}>{lede}</p>
            <span style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: "#5f6470" }}>
              {photo ? <img src={photo} alt="" style={{ width: 30, height: 30, borderRadius: "50%", objectFit: "cover", objectPosition: "center 30%" }} /> : <TeamAvatar size={30} />}
              <span>
                <span style={{ color: "#0b0b0f", fontWeight: 500 }}>{author}</span> · {meta}
              </span>
            </span>
          </div>
        </header>
        <div style={{ padding: "8px 28px 0" }}>
          <div style={{ margin: "0 auto", maxWidth: 960, aspectRatio: "16/8", overflow: "hidden", borderRadius: 20, background: "#18181b" }}>
            {photo ? <img src={photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center 22%" }} /> : <BrandPanel />}
          </div>
        </div>
        {stats.length > 0 && (
          <div style={{ padding: "28px 28px 0" }}>
            <div style={{ margin: "0 auto", display: "grid", maxWidth: 760, gap: 12, gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
              {stats.map(([v, k]) => (
                <span key={k} style={{ display: "flex", flexDirection: "column", gap: 4, borderRadius: 12, background: "#f4f4f5", padding: "16px 18px" }}>
                  <span style={{ fontSize: 26, fontWeight: 500, letterSpacing: "-.02em" }}>{v}</span>
                  <span style={{ fontSize: 13.5, color: "#5f6470" }}>{k}</span>
                </span>
              ))}
            </div>
          </div>
        )}
        <div style={{ padding: "36px 28px 90px" }}>
          <div style={{ margin: "0 auto", display: "flex", maxWidth: 680, flexDirection: "column", gap: 22, fontSize: 17.5, lineHeight: 1.7, color: "#27272a" }}>
            {blocks.map(([kind, text], i) =>
              kind === "h" ? (
                <h2 key={i} style={{ margin: "14px 0 0", fontSize: 24, fontWeight: 500, letterSpacing: "-.02em", lineHeight: 1.25 }}>
                  {text}
                </h2>
              ) : kind === "q" ? (
                <blockquote key={i} style={{ margin: "6px 0", borderRadius: 14, background: "#fdf3ef", padding: "22px 24px", fontSize: 20, lineHeight: 1.45, letterSpacing: "-.01em", color: "#0b0b0f", textWrap: "pretty" }}>
                  “{text}”
                </blockquote>
              ) : (
                <p key={i} style={{ margin: 0, textWrap: "pretty" }}>
                  {text}
                </p>
              ),
            )}
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 14, marginTop: 20, borderTop: "1px solid #e4e4e7", paddingTop: 26, fontSize: 16 }}>
              <span style={{ fontWeight: 500 }}>Record your next conversation on your own server.</span>
              <span style={{ display: "flex", gap: 8 }}>
                <a href={GET_STARTED} className="btn-dark-red" style={{ display: "inline-flex", height: 40, alignItems: "center", borderRadius: 10, background: "#0b0b0f", padding: "0 16px", fontSize: 15, fontWeight: 500, color: "#fff" }}>
                  Get started
                </a>
                <a href="/self-hosting/" style={{ display: "inline-flex", height: 40, alignItems: "center", border: "1px solid #e4e4e7", borderRadius: 10, padding: "0 16px", fontSize: 15, fontWeight: 500 }}>
                  Self-host it
                </a>
              </span>
            </div>
          </div>
        </div>
      </article>
    </Shell>
  );
}
