import { Workflow } from "@/components/Workflow";
import { Explainer } from "@/components/Explainer";

export default function Home() {
  return (
    <>
      <section className="hero">
        <h1>Will this image print well?</h1>
        <p>Upload an image, tell us where you&apos;re printing it, and get a clear answer — plus a file that&apos;s checked and ready to send.</p>
      </section>
      <Workflow />
      <Explainer />
    </>
  );
}
