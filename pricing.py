#!/usr/bin/env python3
"""Provider price tables and token-cost calculation.

Prices are per 1,000,000 tokens. Nothing here fetches vendor prices
automatically: a user can override the table, and known DeepSeek presets carry
an explicit source and checked date.

DeepSeek's public price page (checked 2026-11-28) has cache-hit, cache-miss,
output, peak and off-peak prices. Peak hours are 01:00-04:00 and 06:00-10:00
UTC, Monday-Friday, excluding Chinese public holidays. Chinese public holidays
are not modeled here; the preset explicitly says so. Search/Fetch API usage is
not model-token usage and is not included.
"""
from __future__ import annotations

import datetime

DEEPSEEK_SOURCE = "https://api-docs.deepseek.com/quick_start/pricing"
DEEPSEEK_CHECKED_AT = "2026-11-28"
DEEPSEEK_PEAK_WINDOWS_UTC = ((1, 4), (6, 10))

DEEPSEEK_PRESETS = {
    "deepseek-flash": {
        "inputPerMillion": 0.15,
        "cachedInputPerMillion": 0.003,
        "outputPerMillion": 0.6,
        "peak": {
            "inputPerMillion": 0.3,
            "cachedInputPerMillion": 0.006,
            "outputPerMillion": 1.2,
        },
        "peakWindowsUtc": [list(item) for item in DEEPSEEK_PEAK_WINDOWS_UTC],
        "peakWeekdaysOnly": True,
        "currency": "USD",
        "source": DEEPSEEK_SOURCE,
        "checkedAt": DEEPSEEK_CHECKED_AT,
        "note": "DeepSeek Flash off-peak/peak; cache miss input, cache hit input, output; Chinese holidays not modeled.",
    },
    "deepseek-v4-pro": {
        "inputPerMillion": 0.66,
        "cachedInputPerMillion": 0.022,
        "outputPerMillion": 1.98,
        "peak": {
            "inputPerMillion": 1.32,
            "cachedInputPerMillion": 0.044,
            "outputPerMillion": 3.96,
        },
        "peakWindowsUtc": [list(item) for item in DEEPSEEK_PEAK_WINDOWS_UTC],
        "peakWeekdaysOnly": True,
        "currency": "USD",
        "source": DEEPSEEK_SOURCE,
        "checkedAt": DEEPSEEK_CHECKED_AT,
        "note": "DeepSeek V4 Pro off-peak/peak; cache miss input, cache hit input, output; Chinese holidays not modeled.",
    },
}


def preset_for_model(provider_id, model):
    """Return a built-in DeepSeek preset for a provider/model, or {}."""
    if str(provider_id or "").lower() != "deepseek":
        return {}
    lower = str(model or "").lower()
    if "deepseek-v4-pro" in lower or "v4-pro" in lower:
        return dict(DEEPSEEK_PRESETS["deepseek-v4-pro"])
    if "deepseek-flash" in lower or lower == "deepseek-chat" or lower.startswith("deepseek-chat"):
        # deepseek-chat is a legacy alias; DeepSeek says legacy Flash names are
        # served by the Flash model and billed at the Flash price.
        return dict(DEEPSEEK_PRESETS["deepseek-flash"])
    return {}


def _number(raw, default=None):
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return default
    if value < 0 or value > 1000000:
        return default
    return round(value, 6)


def normalize_pricing(raw):
    """Validate and normalize a price table. Returns {} when disabled/invalid."""
    if not isinstance(raw, dict):
        return {}
    price_in = (_number(raw.get("inputPerMillion"), None)
                if "inputPerMillion" in raw else 0.0)
    price_out = (_number(raw.get("outputPerMillion"), None)
                 if "outputPerMillion" in raw else 0.0)
    cached = _number(raw.get("cachedInputPerMillion"), None)
    if price_in is None or price_out is None:
        return {}
    if price_in == 0 and price_out == 0 and not cached:
        return {}
    currency = str(raw.get("currency") or "USD").upper()
    currency = "".join(ch for ch in currency if "A" <= ch <= "Z")[:8] or "USD"
    out = {
        "inputPerMillion": price_in,
        "outputPerMillion": price_out,
        "currency": currency,
    }
    if cached is not None:
        out["cachedInputPerMillion"] = cached
    peak = raw.get("peak")
    if isinstance(peak, dict):
        peak_in = _number(peak.get("inputPerMillion"), None)
        peak_out = _number(peak.get("outputPerMillion"), None)
        peak_cached = _number(peak.get("cachedInputPerMillion"), None)
        if peak_in is not None and peak_out is not None:
            out["peak"] = {"inputPerMillion": peak_in, "outputPerMillion": peak_out}
            if peak_cached is not None:
                out["peak"]["cachedInputPerMillion"] = peak_cached
    windows = raw.get("peakWindowsUtc")
    if isinstance(windows, list):
        parsed = []
        for window in windows[:8]:
            if not isinstance(window, (list, tuple)) or len(window) != 2:
                continue
            try:
                start, end = int(window[0]), int(window[1])
            except (TypeError, ValueError):
                continue
            if 0 <= start < end <= 24:
                parsed.append([start, end])
        if parsed:
            out["peakWindowsUtc"] = parsed
    if "peakWeekdaysOnly" in raw:
        out["peakWeekdaysOnly"] = bool(raw.get("peakWeekdaysOnly"))
    for key, limit in (("source", 500), ("checkedAt", 40), ("note", 500)):
        if raw.get(key):
            out[key] = str(raw.get(key))[:limit]
    return out


def is_peak(pricing, at=None):
    """Return whether the UTC time is inside a configured peak window."""
    if not isinstance(pricing, dict) or not isinstance(pricing.get("peak"), dict):
        return False
    windows = pricing.get("peakWindowsUtc")
    if not windows:
        return False
    moment = at or datetime.datetime.now(datetime.timezone.utc)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=datetime.timezone.utc)
    moment = moment.astimezone(datetime.timezone.utc)
    if pricing.get("peakWeekdaysOnly", True) and moment.weekday() >= 5:
        return False
    hour = moment.hour + moment.minute / 60.0
    return any(float(start) <= hour < float(end) for start, end in windows)


def cost_for_tokens(settings, tokens_in, tokens_out, cached_tokens=0, at=None):
    """Compute a cost from real token counts and a normalized price table."""
    pricing = (settings or {}).get("pricing") or {}
    if not isinstance(pricing, dict) or not pricing:
        return None
    peak = is_peak(pricing, at)
    table = pricing.get("peak") if peak and isinstance(pricing.get("peak"), dict) else pricing
    price_in = _number(table.get("inputPerMillion"), 0.0) or 0.0
    price_out = _number(table.get("outputPerMillion"), 0.0) or 0.0
    price_cached = _number(table.get("cachedInputPerMillion"), price_in)
    if price_cached is None:
        price_cached = price_in
    tokens_in = max(0, int(tokens_in or 0))
    tokens_out = max(0, int(tokens_out or 0))
    cached = min(tokens_in, max(0, int(cached_tokens or 0)))
    uncached = max(0, tokens_in - cached)
    cost = (uncached / 1000000.0) * price_in + \
           (cached / 1000000.0) * price_cached + \
           (tokens_out / 1000000.0) * price_out
    return round(cost, 8)
