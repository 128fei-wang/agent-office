#!/usr/bin/env python3
"""Local static server with no-store caching for Agent Office.

Only the web app is public. The repo root also contains source, secrets and
dev files (``.git``, ``tests/``, ``scripts/``, ``dev-*.html``, ``*.py``,
``docs/``, ``build/``, …) which must return 404, never be served.
"""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

# Root-level files the app links to directly (in addition to any root *.css).
ALLOWED_FILES = {
    "index.html",
    "site.webmanifest",
    "sw.js",
    "favicon.ico",
    "favicon.svg",
}
# Directories whose contents are public front-end assets.
ALLOWED_DIRS = {"src", "assets"}


def is_public(path):
    """Return True when ``path`` (a URL path, no query string) may be served."""
    rel = unquote(path).lstrip("/")
    if rel in ("", "index.html"):
        return True  # directory index → index.html
    parts = rel.split("/")
    if any(part in ("", ".", "..") for part in parts):
        return False
    if len(parts) == 1:
        name = parts[0]
        return name in ALLOWED_FILES or name.endswith(".css")
    return parts[0] in ALLOWED_DIRS


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def _route(self):
        if not is_public(urlparse(self.path).path):
            self.send_error(404)
            return False
        return True

    def do_GET(self):
        if self._route():
            super().do_GET()

    def do_HEAD(self):
        if self._route():
            super().do_HEAD()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Agent Office static server on http://127.0.0.1:{port} (no-cache)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
