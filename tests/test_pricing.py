#!/usr/bin/env python3
"""Provider price presets and token-cost math."""
import datetime
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import pricing  # noqa: E402


class PricingTest(unittest.TestCase):
    def settings(self, model, pricing_table):
        return {"pricing": pricing_table, "model": model}

    def test_deepseek_flash_off_peak_and_peak(self):
        table = pricing.preset_for_model("deepseek", "deepseek-flash")
        self.assertEqual(table["source"], pricing.DEEPSEEK_SOURCE)
        saturday = datetime.datetime(2026, 11, 28, 12, 0,
                                     tzinfo=datetime.timezone.utc)
        monday_peak = datetime.datetime(2026, 11, 30, 2, 0,
                                        tzinfo=datetime.timezone.utc)
        off = pricing.cost_for_tokens(self.settings("deepseek-flash", table),
                                      512, 5165, 0, saturday)
        peak = pricing.cost_for_tokens(self.settings("deepseek-flash", table),
                                       512, 5165, 0, monday_peak)
        self.assertAlmostEqual(off, 0.0031758, places=7)
        self.assertAlmostEqual(peak, 0.0063516, places=7)
        self.assertFalse(pricing.is_peak(table, saturday))
        self.assertTrue(pricing.is_peak(table, monday_peak))

    def test_cache_hit_uses_cached_price(self):
        table = pricing.preset_for_model("deepseek", "deepseek-flash")
        saturday = datetime.datetime(2026, 11, 28, 12, 0,
                                     tzinfo=datetime.timezone.utc)
        cost = pricing.cost_for_tokens(self.settings("deepseek-flash", table),
                                       1000, 0, 500, saturday)
        expected = (500 / 1_000_000.0) * 0.15 + \
                   (500 / 1_000_000.0) * 0.003
        self.assertAlmostEqual(cost, round(expected, 8), places=8)

    def test_deepseek_pro_preset(self):
        table = pricing.preset_for_model("deepseek", "deepseek-v4-pro")
        self.assertEqual(table["inputPerMillion"], 0.66)
        self.assertEqual(table["outputPerMillion"], 1.98)
        self.assertEqual(table["peak"]["outputPerMillion"], 3.96)

    def test_legacy_deepseek_chat_maps_to_flash(self):
        table = pricing.preset_for_model("deepseek", "deepseek-chat")
        self.assertEqual(table["inputPerMillion"], 0.15)

    def test_unknown_provider_has_no_preset(self):
        self.assertEqual(pricing.preset_for_model("openai", "gpt"), {})

    def test_user_price_table_without_preset(self):
        table = pricing.normalize_pricing({
            "inputPerMillion": 1, "outputPerMillion": 2, "currency": "USD",
        })
        cost = pricing.cost_for_tokens(self.settings("x", table), 1_000_000, 0)
        self.assertEqual(cost, 1.0)
        self.assertFalse(pricing.is_peak(table))

    def test_zero_or_invalid_pricing_is_disabled(self):
        self.assertEqual(pricing.normalize_pricing({}), {})
        self.assertEqual(pricing.normalize_pricing({
            "inputPerMillion": -1, "outputPerMillion": -1}), {})
        self.assertEqual(pricing.normalize_pricing({
            "inputPerMillion": "nope", "outputPerMillion": 2}), {})

    def test_peak_weekend_is_off_peak(self):
        table = pricing.preset_for_model("deepseek", "deepseek-flash")
        sunday = datetime.datetime(2026, 11, 29, 2, 0,
                                   tzinfo=datetime.timezone.utc)
        self.assertFalse(pricing.is_peak(table, sunday))


if __name__ == "__main__":
    unittest.main()
