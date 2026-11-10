import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Article } from "@/components/article";
import { customers } from "@/content/customers";

export const dynamicParams = false;

// A static export needs at least one page per dynamic route, so while there are no stories a
// placeholder is built, which is the 404 page.
const NONE = "_none";

export function generateStaticParams() {
  return customers.length ? customers.map((c) => ({ slug: c.slug })) : [{ slug: NONE }];
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const c = customers.find((x) => x.slug === slug);
  if (!c) return { robots: { index: false } };
  return { title: `${c.story.title} · Tapry`, description: c.story.lede, alternates: { canonical: `/customers/${c.slug}/` } };
}

export default async function StoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = customers.find((x) => x.slug === slug);
  if (!c) notFound();
  return (
    <Article
      nav="customers"
      back={["Customers", "/customers/"]}
      tag={`Customer story · ${c.tag}`}
      title={c.story.title}
      lede={c.story.lede}
      author={c.name}
      meta={`${c.role}, ${c.org}`}
      photo={c.photo}
      stats={c.story.stats}
      blocks={c.story.blocks}
    />
  );
}
