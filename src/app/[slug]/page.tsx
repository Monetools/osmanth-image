import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Workflow } from "@/components/Workflow";
import { Explainer } from "@/components/Explainer";
import { getIntent, INTENTS } from "@/engine/intents";

// Every SEO entrance is the SAME workflow with a preselected intent — no per-page tools.
export const dynamicParams = false;

export function generateStaticParams() {
  return INTENTS.map((i) => ({ slug: i.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const intent = getIntent((await params).slug);
  if (!intent) return {};
  return { title: intent.title, description: intent.description, alternates: { canonical: `/${intent.slug}` } };
}

export default async function IntentPage({ params }: { params: Promise<{ slug: string }> }) {
  const intent = getIntent((await params).slug);
  if (!intent) notFound();
  return (
    <>
      <section className="hero">
        <h1>{intent.h1}</h1>
        <p>{intent.intro}</p>
      </section>
      <Workflow intent={intent} />
      <Explainer />
    </>
  );
}
