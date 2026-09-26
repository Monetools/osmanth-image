import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Explainer } from "@/components/Explainer";
import { Hero } from "@/components/Hero";
import { JsonLd } from "@/components/JsonLd";
import { Workflow } from "@/components/Workflow";
import { getIntent, INTENTS } from "@/engine/intents";
import { pageMetadata, webApplicationJsonLd } from "@/seo";

// Every SEO entrance is the SAME workflow with a preselected intent — no per-page tools.
export const dynamicParams = false;

export function generateStaticParams() {
  return INTENTS.map((i) => ({ slug: i.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const intent = getIntent((await params).slug);
  if (!intent) return {};
  return pageMetadata({ path: intent.slug, title: intent.title, description: intent.description });
}

export default async function IntentPage({ params }: { params: Promise<{ slug: string }> }) {
  const intent = getIntent((await params).slug);
  if (!intent) notFound();
  return (
    <>
      <JsonLd data={webApplicationJsonLd({ path: intent.slug, name: intent.h1, description: intent.description })} />
      <Hero title={intent.h1} lede={intent.intro} />
      <Workflow intent={intent} />
      <Explainer />
    </>
  );
}
