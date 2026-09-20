"""
Minimal self-hosted GPU worker for the `realesrgan-selfhosted` provider.

Contract (see src/engine/enhance/providers.ts):
  POST /v1/upscale?scale=2|4&face=0   Authorization: Bearer $PRINTREADY_GPU_WORKER_TOKEN
  body: image bytes (PNG/JPEG)  ->  200 image/png, headers x-output-width / x-output-height

Privacy (spec §19): the image is held in memory only for the request; nothing is written to disk,
no URL to it exists, nothing is logged except timing. Face restoration is not implemented here and
the flag is rejected until a face model passes the licence audit.

DO NOT deploy until PRINTREADY_OSS_LICENSE_AUDIT.md clears the weights being served.
"""
from __future__ import annotations

import io
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from PIL import Image

from run_benchmark import TorchModel

MAX_BYTES = 80 * 1024 * 1024
MAX_INPUT_PIXELS = 25_000_000
Image.MAX_IMAGE_PIXELS = MAX_INPUT_PIXELS  # Pillow's decompression-bomb guard

TOKEN = os.environ.get("PRINTREADY_GPU_WORKER_TOKEN", "")
WEIGHTS = Path(os.environ.get("PRINTREADY_WEIGHTS_DIR", Path(__file__).parent / "weights"))
MODELS = {
    2: TorchModel(WEIGHTS / "RealESRGAN_x2plus.pth", "cuda", tile=512, half=True),
    4: TorchModel(WEIGHTS / "RealESRGAN_x4plus.pth", "cuda", tile=512, half=True),
}


class Handler(BaseHTTPRequestHandler):
    def _fail(self, code: int, msg: str) -> None:
        body = msg.encode()
        self.send_response(code)
        self.send_header("content-type", "text/plain")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:  # noqa: N802
        u = urlparse(self.path)
        if u.path != "/v1/upscale":
            return self._fail(404, "not found")
        if not TOKEN or self.headers.get("authorization") != f"Bearer {TOKEN}":
            return self._fail(401, "unauthorized")
        q = parse_qs(u.query)
        scale = int(q.get("scale", ["0"])[0])
        if scale not in MODELS:
            return self._fail(400, "bad scale")
        if q.get("face", ["0"])[0] != "0":
            return self._fail(400, "face restoration not available")
        n = int(self.headers.get("content-length") or 0)
        if n <= 0 or n > MAX_BYTES:
            return self._fail(413, "bad size")
        data = self.rfile.read(n)
        try:
            im = Image.open(io.BytesIO(data))
            if im.format not in ("PNG", "JPEG", "WEBP"):
                return self._fail(415, "unsupported format")
            if im.width * im.height > MAX_INPUT_PIXELS:
                return self._fail(413, "too many pixels")
            import numpy as np

            arr = np.asarray(im.convert("RGB"))
        except Exception:
            return self._fail(422, "unreadable image")
        t0 = time.perf_counter()
        out, _ = MODELS[scale].run(arr)
        buf = io.BytesIO()
        Image.fromarray(out).save(buf, format="PNG")
        body = buf.getvalue()
        self.send_response(200)
        self.send_header("content-type", "image/png")
        self.send_header("content-length", str(len(body)))
        self.send_header("x-output-width", str(out.shape[1]))
        self.send_header("x-output-height", str(out.shape[0]))
        self.send_header("x-seconds", f"{time.perf_counter() - t0:.3f}")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt: str, *args) -> None:  # never log request paths/bodies
        pass


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8765"))
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
