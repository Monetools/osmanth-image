import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Explainer } from "@/components/Explainer";
import { ToolGuides } from "@/components/GuideLinks";
import { Hero } from "@/components/Hero";
import { JsonLd } from "@/components/JsonLd";
import { SizeAnswer } from "@/components/SizeAnswer";
import { Workflow } from "@/components/Workflow";
import { getIntent, INTENTS } from "@/engine/intents";
import { getGuide, guidesForTool } from "@/guides/guides";
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
      {/* Pages about one fixed photo size also answer "how many pixels?" directly, from that size's profile. */}
      {intent.profileId?.startsWith("photo.") && (
        <SizeAnswer profileId={intent.profileId} guideHref={getGuide("poster-size-in-pixels") ? "/guides/poster-size-in-pixels/" : undefined} />
      )}
      <Explainer />
      <ToolGuides guides={guidesForTool(intent.slug)} />
    </>
  );
}
