import { Explainer } from "@/components/Explainer";
import { GuidesTeaser } from "@/components/GuideLinks";
import { Hero } from "@/components/Hero";
import { JsonLd } from "@/components/JsonLd";
import { Workflow } from "@/components/Workflow";
import { allGuides } from "@/guides/guides";
import { pageMetadata, webApplicationJsonLd } from "@/seo";
import { DESCRIPTION, SITE_NAME, TAGLINE } from "@/site";

export const metadata = pageMetadata({ path: "/" });

export default function Home() {
  return (
    <>
      <JsonLd data={webApplicationJsonLd({ path: "/", name: SITE_NAME, description: DESCRIPTION })} />
      <Hero
        title={TAGLINE}
        lede="Check your image, fix what can be fixed, and download a file that's ready to print. Your image never leaves your device."
      />
      <Workflow />
      <Explainer />
      <GuidesTeaser guides={allGuides().slice(0, 3)} />
    </>
  );
}
