import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Article } from "@/components/article";
import { postHref, posts, readingMinutes } from "@/content/blog";
import { pageMeta } from "@/content/site";

export const dynamicParams = false;

export function generateStaticParams() {
  return posts.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const p = posts.find((x) => x.slug === slug);
  if (!p) return {};
  return pageMeta({ title: `${p.title} · Tapry`, description: p.lede, path: postHref(p) });
}

export default async function PostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = posts.find((x) => x.slug === slug);
  if (!p) notFound();
  return (
    <Article
      nav="resources"
      back={["Blog", "/blog/"]}
      tag={p.tag}
      title={p.title}
      lede={p.lede}
      author={p.author}
      meta={`${p.date} · ${readingMinutes(p)} min read`}
      blocks={p.blocks}
    />
  );
}
