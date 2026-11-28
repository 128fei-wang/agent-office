#!/usr/bin/env python3
"""Render a local SVG to PNG with headless Chromium (development only).

Used by scripts/build-icons.sh. The shipped app never needs Node or a browser
build step; brand PNG/ICNS files are committed under assets/brand.
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

CHROME_CANDIDATES = [
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "chromium",
    "chromium-browser",
    "google-chrome",
    "google-chrome-stable",
]


def find_chrome() -> str:
    env = os.environ.get("CHROME") or os.environ.get("CHROMIUM")
    if env and Path(env).exists():
        return env
    for candidate in CHROME_CANDIDATES:
        if os.path.isabs(candidate):
            if Path(candidate).exists():
                return candidate
        else:
            found = shutil.which(candidate)
            if found:
                return found
    raise SystemExit("Chromium/Chrome not found; set CHROME=/path/to/chrome")


def render(svg: Path, out: Path, width: int, height: int) -> None:
    svg = svg.resolve()
    out = out.resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    chrome = find_chrome()
    with tempfile.TemporaryDirectory(prefix="ao-render-") as tmp:
        html = Path(tmp) / "render.html"
        profile = Path(tmp) / "profile"
        html.write_text(
            "<!doctype html><meta charset=\"utf-8\">"
            "<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}"
            "img{display:block;width:%dpx;height:%dpx}</style>"
            "<img src=\"%s\" width=\"%d\" height=\"%d\">"
            % (width, height, svg.as_uri(), width, height),
            encoding="utf-8",
        )
        command = [
            chrome,
            "--headless=new",
            "--disable-gpu",
            "--hide-scrollbars",
            "--no-first-run",
            "--force-device-scale-factor=1",
            "--default-background-color=00000000",
            f"--window-size={width},{height}",
            f"--user-data-dir={profile}",
            "--virtual-time-budget=1500",
            f"--screenshot={out}",
            html.as_uri(),
        ]
        result = subprocess.run(command, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, text=True, timeout=90)
        if result.returncode != 0 or not out.exists():
            # Older Chromium builds do not support --headless=new.
            command[1] = "--headless"
            result = subprocess.run(command, stdout=subprocess.PIPE,
                                    stderr=subprocess.PIPE, text=True, timeout=90)
        if result.returncode != 0 or not out.exists():
            sys.stderr.write(result.stderr[-2000:])
            raise SystemExit(f"render failed: {svg} -> {out}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("svg")
    parser.add_argument("out")
    parser.add_argument("--width", type=int, required=True)
    parser.add_argument("--height", type=int, required=True)
    args = parser.parse_args()
    render(Path(args.svg), Path(args.out), args.width, args.height)
    print(f"rendered {args.out} ({args.width}x{args.height})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
