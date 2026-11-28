#!/usr/bin/env python3
"""Committed brand assets, install metadata and local-only logo sources."""
import json
import struct
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BRAND = ROOT / "assets" / "brand"


def png_size(path):
    data = Path(path).read_bytes()[:24]
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise AssertionError(f"not a PNG: {path}")
    return struct.unpack(">II", data[16:24])


class BrandingTest(unittest.TestCase):
    def test_required_brand_assets_exist(self):
        required = [
            "agent-office-mark.svg", "agent-office-favicon.svg",
            "agent-office-logo.svg", "agent-office-social.svg",
            "agent-office-app-icon.svg", "agent-office-touch.svg",
            "agent-office-maskable.svg",
            "favicon-16.png", "favicon-32.png", "favicon-48.png",
            "favicon.ico", "apple-touch-icon.png", "icon-192.png",
            "icon-512.png", "icon-maskable-512.png", "icon-256.png",
            "og-image.png", "agent-office-logo.png", "AppIcon.icns",
        ]
        for name in required:
            with self.subTest(name=name):
                self.assertTrue((BRAND / name).is_file(), name)
        self.assertTrue((ROOT / "site.webmanifest").is_file())
        self.assertTrue((ROOT / "favicon.svg").is_file())
        self.assertTrue((ROOT / "sw.js").is_file())

    def test_raster_sizes(self):
        expected = {
            "favicon-16.png": (16, 16),
            "favicon-32.png": (32, 32),
            "favicon-48.png": (48, 48),
            "apple-touch-icon.png": (180, 180),
            "icon-192.png": (192, 192),
            "icon-512.png": (512, 512),
            "icon-maskable-512.png": (512, 512),
            "icon-256.png": (256, 256),
            "og-image.png": (1200, 630),
            "agent-office-logo.png": (1200, 360),
        }
        for name, size in expected.items():
            with self.subTest(name=name):
                self.assertEqual(png_size(BRAND / name), size)

    def test_manifest_icons_resolve_and_match_sizes(self):
        manifest = json.loads((ROOT / "site.webmanifest").read_text("utf-8"))
        self.assertEqual(manifest["name"], "Agent Office")
        self.assertEqual(manifest["theme_color"], "#07131d")
        self.assertEqual(manifest["start_url"], "./")
        self.assertTrue(manifest["icons"])
        self.assertTrue(any("maskable" in (icon.get("purpose") or "")
                            for icon in manifest["icons"]))
        for icon in manifest["icons"]:
            path = ROOT / icon["src"]
            self.assertTrue(path.is_file(), path)
            width, height = (int(part) for part in icon["sizes"].split("x"))
            self.assertEqual(png_size(path), (width, height), path)

    def test_index_install_and_social_metadata(self):
        html = (ROOT / "index.html").read_text("utf-8")
        for needle in [
            'rel="manifest" href="site.webmanifest"',
            'rel="apple-touch-icon"',
            'rel="icon" href="assets/brand/agent-office-favicon.svg',
            'assets/brand/favicon-32.png',
            'assets/brand/favicon-16.png',
            'assets/brand/favicon.ico',
            'name="theme-color" content="#07131d"',
            'property="og:image" content="assets/brand/og-image.png"',
            'name="twitter:card" content="summary_large_image"',
            'class="brand-mark"',
            'class="boot-logo"',
        ]:
            with self.subTest(needle=needle):
                self.assertIn(needle, html)
        self.assertNotIn('href="favicon.svg"', html)
        self.assertTrue((ROOT / "assets/brand/og-image.png").is_file())

    def test_install_service_worker_is_network_only(self):
        sw = (ROOT / "sw.js").read_text("utf-8")
        self.assertIn('addEventListener("fetch"', sw)
        self.assertNotIn("cache.put", sw)
        main = (ROOT / "src/main.js").read_text("utf-8")
        self.assertIn("serviceWorker.register", main)

    def test_root_favicon_matches_brand_source(self):
        self.assertEqual((ROOT / "favicon.svg").read_bytes(),
                         (BRAND / "agent-office-favicon.svg").read_bytes())
        self.assertEqual((ROOT / "favicon.ico").read_bytes(),
                         (BRAND / "favicon.ico").read_bytes())
        svg = (ROOT / "favicon.svg").read_text("utf-8")
        self.assertIn('viewBox="0 0 16 16"', svg)
        self.assertIn("#55d6c2", svg)
        self.assertIn("#f2b544", svg)

    def test_brand_svg_sources_do_not_load_remote_images(self):
        svgs = sorted(BRAND.glob("*.svg")) + [ROOT / "favicon.svg"]
        for path in svgs:
            text = path.read_text("utf-8")
            with self.subTest(path=path.name):
                self.assertNotRegex(text, r'(?:href|src)="https?://(?!www\.w3\.org)')
                self.assertNotIn("url(http", text)
                self.assertNotIn("@import", text)

    def test_app_icon_and_iconset(self):
        icns = (BRAND / "AppIcon.icns").read_bytes()
        self.assertEqual(icns[:4], b"icns")
        self.assertGreater(len(icns), 10000)
        expected = {
            "icon_16x16.png": (16, 16),
            "icon_16x16@2x.png": (32, 32),
            "icon_32x32.png": (32, 32),
            "icon_32x32@2x.png": (64, 64),
            "icon_128x128.png": (128, 128),
            "icon_128x128@2x.png": (256, 256),
            "icon_256x256.png": (256, 256),
            "icon_256x256@2x.png": (512, 512),
            "icon_512x512.png": (512, 512),
            "icon_512x512@2x.png": (1024, 1024),
        }
        for name, size in expected.items():
            path = BRAND / "icon.iconset" / name
            with self.subTest(name=name):
                self.assertTrue(path.is_file(), name)
                self.assertEqual(png_size(path), size)

    def test_windows_ico_container(self):
        data = (BRAND / "favicon.ico").read_bytes()
        reserved, kind, count = struct.unpack("<HHH", data[:6])
        self.assertEqual((reserved, kind), (0, 1))
        self.assertEqual(count, 4)
        self.assertIn(b"\x89PNG\r\n\x1a\n", data)

    def test_brand_palette_is_present(self):
        mark = (BRAND / "agent-office-mark.svg").read_text("utf-8")
        for color in ("#55d6c2", "#f2b544", "#ff7fa8", "#b58cff", "#07131d"):
            with self.subTest(color=color):
                self.assertIn(color, mark)
        logo = (BRAND / "agent-office-logo.svg").read_text("utf-8")
        self.assertIn("SEE THE TEAM. SHIP THE WORK.", logo)


if __name__ == "__main__":
    unittest.main()
