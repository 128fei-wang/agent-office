#!/usr/bin/env python3
"""Run Agent Office's headless browser self-checks.

The app is a static, zero-build frontend. Each dev-*.html page runs a
deterministic scenario and writes PASS/FAIL into its document title and/or
<pre id="out">. This runner serves the repo, launches Chromium, and asserts those
results in parallel, so the browser suite can run locally or in CI without
Playwright or Node.

Usage:
    python3 scripts/browser_suite.py --chrome /path/to/chromium
    python3 scripts/browser_suite.py --pages dev-check.html,dev-paths.html
"""
from __future__ import annotations

import argparse
import concurrent.futures
import html
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PAGES = sorted(path.name for path in ROOT.glob("dev-*.html"))
SMOKE_PAGES = [
    "dev-check.html", "dev-consistency.html", "dev-paths.html",
    "dev-actions.html", "dev-path-debug.html", "dev-brand.html",
]
# These pages read or mutate the shared local bridge (agents, missions, chats,
# company state, memory). Running them in parallel makes counts flaky because
# one page can delete an agent another page is asserting on. Run this set
# sequentially; engine-only pages stay parallel.
BRIDGE_PAGES = {
    "dev-ai-setup.html", "dev-audit.html", "dev-chat.html", "dev-company.html",
    "dev-delegation.html", "dev-external.html", "dev-features.html",
    "dev-memory.html", "dev-missions.html", "dev-usage.html",
}
PASS_TITLES = {"PASS", "CLEAN", "DEBUG"}


def chrome_binary(explicit=""):
    candidates = [
        explicit,
        os.environ.get("CHROME_BIN", ""),
        "/Applications/AgentOffice.app/Contents/MacOS/chromium-bin",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        shutil.which("google-chrome") or "",
        shutil.which("chromium") or "",
        shutil.which("chromium-browser") or "",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return candidate
    raise SystemExit("Chromium/Chrome not found; pass --chrome or set CHROME_BIN")


class StaticHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):
        pass


def start_server():
    server = ThreadingHTTPServer(("127.0.0.1", 0), StaticHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, server.server_address[1]


def result_from_page(source):
    title_match = re.search(r"<title>(.*?)</title>", source, re.S | re.I)
    title = html.unescape(title_match.group(1)).strip() if title_match else ""
    pre_match = re.search(r'<pre id="out">(.*?)</pre>', source, re.S | re.I)
    pre = html.unescape(pre_match.group(1)) if pre_match else ""
    if title == "FAIL" or title.startswith("ERROR") or re.search(r"^FAIL\s", pre, re.M):
        return False, title or "FAIL", pre
    if title in PASS_TITLES or re.match(r"^TRACE\b.*DONE$", title):
        return True, title, pre
    if "ALL CHECKS PASS" in pre:
        return True, title or "PASS", pre
    return False, title or "NO RESULT", pre


def run_page(chrome, port, page, budget, timeout):
    profile = tempfile.mkdtemp(prefix="ao-e2e-")
    url = "http://127.0.0.1:%s/%s?e2e=1" % (port, quote(page))
    command = [
        chrome, "--headless=new", "--no-sandbox", "--disable-gpu",
        "--hide-scrollbars", "--user-data-dir=" + profile,
        "--virtual-time-budget=" + str(budget), "--dump-dom", url,
    ]
    started = time.time()
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=timeout)
        ok, title, pre = result_from_page(result.stdout or "")
        failures = [line for line in pre.splitlines() if line.startswith("FAIL")]
        return {
            "page": page, "ok": ok, "title": title,
            "durationMs": int((time.time() - started) * 1000),
            "failures": failures[-8:],
            "stderr": (result.stderr or "")[-400:] if not ok else "",
        }
    except subprocess.TimeoutExpired:
        return {"page": page, "ok": False, "title": "TIMEOUT",
                "durationMs": int((time.time() - started) * 1000),
                "failures": [], "stderr": ""}
    finally:
        shutil.rmtree(profile, ignore_errors=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--chrome", default="")
    parser.add_argument("--pages", default="", help="comma-separated dev pages")
    parser.add_argument("--smoke", action="store_true", help="run the CI smoke subset")
    parser.add_argument("--jobs", type=int, default=4)
    parser.add_argument("--budget", type=int, default=110000)
    parser.add_argument("--timeout", type=int, default=240)
    args = parser.parse_args()
    chrome = chrome_binary(args.chrome)
    if args.smoke:
        pages = SMOKE_PAGES
    elif args.pages:
        pages = [part.strip() for part in args.pages.split(",") if part.strip()]
    else:
        pages = DEFAULT_PAGES
    missing = [page for page in pages if not (ROOT / page).exists()]
    if missing:
        raise SystemExit("missing pages: " + ", ".join(missing))
    server, port = start_server()
    started = time.time()
    print("browser suite: %s pages, %s workers, chromium=%s" %
          (len(pages), args.jobs, chrome), flush=True)
    results = []
    bridge_pages = [page for page in pages if page in BRIDGE_PAGES]
    safe_pages = [page for page in pages if page not in BRIDGE_PAGES]
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.jobs)) as pool:
            futures = [pool.submit(run_page, chrome, port, page, args.budget, args.timeout)
                       for page in safe_pages]
            for future in concurrent.futures.as_completed(futures):
                row = future.result()
                results.append(row)
                print(("PASS  " if row["ok"] else "FAIL  ") + row["page"] +
                      "  " + row["title"] + "  " + str(row["durationMs"]) + "ms", flush=True)
        for page in bridge_pages:
            row = run_page(chrome, port, page, args.budget, args.timeout)
            results.append(row)
            print(("PASS  " if row["ok"] else "FAIL  ") + row["page"] +
                  "  " + row["title"] + "  " + str(row["durationMs"]) + "ms", flush=True)
    finally:
        server.shutdown()
        server.server_close()
    failed = [row for row in results if not row["ok"]]
    print("\n%d/%d browser pages passed in %.1fs" %
          (len(results) - len(failed), len(results), time.time() - started), flush=True)
    for row in failed:
        print("\nFAILED: " + row["page"] + " (" + row["title"] + ")")
        for line in row["failures"]:
            print("  " + line)
        if row["stderr"]:
            print("  stderr: " + row["stderr"].replace("\n", " ")[-300:])
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
