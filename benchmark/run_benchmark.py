"""
PrintReady enhancement benchmark (spec §23).

For every corpus image x model x scale it records:
  * time (s), peak VRAM (MB), output megapixels, tiles used
  * full-reference quality on a round trip: original -> downscale by s -> upscale by s -> compare
    to the original (PSNR / SSIM). This is objective but favours "faithful" models; it does NOT
    replace visual review.
  * a side-by-side PNG (original crop | Lanczos | model) for human review of identity/text/artifacts

Usage:
  python run_benchmark.py --corpus corpus --weights weights --out output --usd-per-gpu-hour 0.50
  python run_benchmark.py --baseline-only        # Lanczos only; needs no torch

Nothing here is used by production code; results are copied into PRINTREADY_MODEL_BENCHMARK.md
and PRINTREADY_UNIT_ECONOMICS.md by a human.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import platform
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).parent


@dataclass
class Row:
    image: str
    category: str
    model: str
    scale: int
    input_px: str
    output_mp: float
    seconds: float
    peak_vram_mb: float | None
    tiles: int
    roundtrip_psnr: float | None
    roundtrip_ssim: float | None
    usd_estimate: float | None
    error: str | None = None
    notes: list[str] = field(default_factory=list)


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_rgb(p: Path) -> np.ndarray:
    im = Image.open(p)
    im = im.convert("RGB")
    return np.asarray(im)


def lanczos(img: np.ndarray, scale: float) -> np.ndarray:
    h, w = img.shape[:2]
    return np.asarray(Image.fromarray(img).resize((round(w * scale), round(h * scale)), Image.LANCZOS))


def metrics(ref: np.ndarray, out: np.ndarray) -> tuple[float, float]:
    from skimage.metrics import peak_signal_noise_ratio, structural_similarity

    h = min(ref.shape[0], out.shape[0])
    w = min(ref.shape[1], out.shape[1])
    a, b = ref[:h, :w], out[:h, :w]
    return float(peak_signal_noise_ratio(a, b, data_range=255)), float(structural_similarity(a, b, channel_axis=2, data_range=255))


class TorchModel:
    """Loads any spandrel-supported SR checkpoint and runs it with tiling."""

    def __init__(self, path: Path, device: str, tile: int, half: bool):
        import torch
        from spandrel import ModelLoader

        self.torch = torch
        self.desc = ModelLoader().load_from_file(str(path))
        self.scale = int(self.desc.scale)
        self.device = device
        self.tile = tile
        self.model = self.desc.model.eval().to(device)
        self.half = half and device.startswith("cuda") and self.desc.supports_half
        if self.half:
            self.model = self.model.half()

    def run(self, img: np.ndarray) -> tuple[np.ndarray, int]:
        torch = self.torch
        x = torch.from_numpy(img).permute(2, 0, 1).float().div(255).unsqueeze(0).to(self.device)
        if self.half:
            x = x.half()
        _, _, h, w = x.shape
        s = self.scale
        if self.tile <= 0 or (h <= self.tile and w <= self.tile):
            with torch.inference_mode():
                y = self.model(x)
            tiles = 1
        else:
            pad = 16
            y = torch.zeros((1, 3, h * s, w * s), dtype=x.dtype, device=self.device)
            tiles = 0
            with torch.inference_mode():
                for ty in range(0, h, self.tile):
                    for tx in range(0, w, self.tile):
                        y0, x0 = max(ty - pad, 0), max(tx - pad, 0)
                        y1, x1 = min(ty + self.tile + pad, h), min(tx + self.tile + pad, w)
                        out = self.model(x[:, :, y0:y1, x0:x1])
                        th, tw = min(self.tile, h - ty), min(self.tile, w - tx)
                        oy, ox = (ty - y0) * s, (tx - x0) * s
                        y[:, :, ty * s:(ty + th) * s, tx * s:(tx + tw) * s] = out[:, :, oy:oy + th * s, ox:ox + tw * s]
                        tiles += 1
        arr = y.squeeze(0).float().clamp(0, 1).mul(255).round().byte().permute(1, 2, 0).cpu().numpy()
        return arr, tiles


def side_by_side(orig: np.ndarray, base: np.ndarray, model: np.ndarray, scale: int, dest: Path) -> None:
    """Centre crop at output scale: nearest-neighbour original | Lanczos | model."""
    ch, cw = min(256, orig.shape[0]), min(256, orig.shape[1])
    y0, x0 = (orig.shape[0] - ch) // 2, (orig.shape[1] - cw) // 2
    crop = orig[y0:y0 + ch, x0:x0 + cw]
    nn = np.asarray(Image.fromarray(crop).resize((cw * scale, ch * scale), Image.NEAREST))
    b = base[y0 * scale:(y0 + ch) * scale, x0 * scale:(x0 + cw) * scale]
    m = model[y0 * scale:(y0 + ch) * scale, x0 * scale:(x0 + cw) * scale]
    Image.fromarray(np.concatenate([nn, b, m], axis=1)).save(dest)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--corpus", default=str(HERE / "corpus"))
    ap.add_argument("--weights", default=str(HERE / "weights"))
    ap.add_argument("--out", default=str(HERE / "output"))
    ap.add_argument("--tile", type=int, default=512)
    ap.add_argument("--fp16", action="store_true")
    ap.add_argument("--usd-per-gpu-hour", type=float, default=None)
    ap.add_argument("--baseline-only", action="store_true")
    args = ap.parse_args()

    corpus, weights, out = Path(args.corpus), Path(args.weights), Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((corpus / "manifest.json").read_text(encoding="utf-8"))
    models = json.loads((HERE / "models.json").read_text(encoding="utf-8"))["models"]

    env: dict = {"python": platform.python_version(), "platform": platform.platform()}
    device = "cpu"
    loaded: list[tuple[dict, TorchModel]] = []
    if not args.baseline_only:
        import torch

        device = "cuda" if torch.cuda.is_available() else "cpu"
        env.update(torch=torch.__version__, device=device, gpu=torch.cuda.get_device_name(0) if device == "cuda" else None)
        for m in models:
            p = weights / m["file"]
            if not p.exists():
                print(f"skip {m['id']}: {p} missing")
                continue
            loaded.append(({**m, "sha256": sha256(p)}, TorchModel(p, device, args.tile, args.fp16)))

    rows: list[Row] = []
    for item in manifest["items"]:
        p = corpus / item["file"]
        if not p.exists():
            print(f"skip image {item['id']}: missing")
            continue
        img = load_rgb(p)
        h, w = img.shape[:2]
        for scale in (2, 4):
            base = lanczos(img, scale)
            t0 = time.perf_counter()
            small = lanczos(img, 1 / scale)
            rt = lanczos(small, scale)
            psnr, ssim = metrics(img, rt)
            rows.append(Row(item["id"], item["category"], "lanczos", scale, f"{w}x{h}", base.shape[0] * base.shape[1] / 1e6,
                            time.perf_counter() - t0, None, 1, psnr, ssim, 0.0))
            for meta, model in loaded:
                if model.scale != scale:
                    continue
                try:
                    import torch

                    if device == "cuda":
                        torch.cuda.reset_peak_memory_stats()
                        torch.cuda.synchronize()
                    model.run(img[:64, :64])  # warm-up
                    if device == "cuda":
                        torch.cuda.synchronize()
                    t0 = time.perf_counter()
                    up, tiles = model.run(img)
                    if device == "cuda":
                        torch.cuda.synchronize()
                    secs = time.perf_counter() - t0
                    vram = torch.cuda.max_memory_allocated() / 2**20 if device == "cuda" else None
                    rt_small = lanczos(img, 1 / scale)
                    rt_up, _ = model.run(rt_small)
                    psnr, ssim = metrics(img, rt_up)
                    usd = secs / 3600 * args.usd_per_gpu_hour if args.usd_per_gpu_hour else None
                    rows.append(Row(item["id"], item["category"], meta["id"], scale, f"{w}x{h}", up.shape[0] * up.shape[1] / 1e6,
                                    secs, vram, tiles, psnr, ssim, usd))
                    side_by_side(img, base, up, scale, out / f"{item['id']}__{meta['id']}.png")
                except Exception as e:  # record failures: they are part of the failure/retry rate
                    rows.append(Row(item["id"], item["category"], meta["id"], scale, f"{w}x{h}", 0, 0, None, 0, None, None, None, error=repr(e)))

    (out / "results.json").write_text(json.dumps({"env": env, "models": [m for m, _ in loaded], "rows": [asdict(r) for r in rows]}, indent=2))
    with (out / "results.csv").open("w", newline="") as f:
        wr = csv.DictWriter(f, fieldnames=list(asdict(rows[0]).keys()) if rows else ["image"])
        wr.writeheader()
        for r in rows:
            wr.writerow(asdict(r))
    print(f"{len(rows)} rows -> {out}")


if __name__ == "__main__":
    main()
