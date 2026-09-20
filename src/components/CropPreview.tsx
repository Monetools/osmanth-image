"use client";

import type { CropRect } from "@/engine/preflight/geometry";

/** Shows exactly what will be kept (crop) or how the whole image sits on the page (fit). */
export function CropPreview(props: {
  src: string;
  imageW: number;
  imageH: number;
  crop: CropRect;
  mode: "crop" | "fit";
  targetRatio: number;
  maxHeight?: number;
}) {
  const { src, imageW, imageH, crop, mode, targetRatio } = props;
  const maxH = props.maxHeight ?? 360;
  if (mode === "fit" && crop.axis !== "none") {
    const w = Math.round(maxH * targetRatio);
    const inset = imageW / imageH > targetRatio ? { width: "100%" } : { height: "100%" };
    return (
      <div className="fit-frame" style={{ width: w, aspectRatio: `${targetRatio}` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} style={inset} alt="How the whole image sits on the print, with white borders" />
      </div>
    );
  }
  const ratio = imageW / imageH;
  const h = Math.min(maxH, 360);
  return (
    <div className="preview" style={{ width: Math.round(h * ratio), aspectRatio: `${ratio}` }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="Your image with the printed area highlighted" />
      <div
        className="keep"
        style={{
          left: `${(crop.x / imageW) * 100}%`,
          top: `${(crop.y / imageH) * 100}%`,
          width: `${(crop.w / imageW) * 100}%`,
          height: `${(crop.h / imageH) * 100}%`,
        }}
      />
    </div>
  );
}
