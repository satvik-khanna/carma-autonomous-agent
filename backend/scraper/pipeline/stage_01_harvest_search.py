#!/usr/bin/env python3
"""
Stage 1 — Harvest Craigslist search results using TWO sort orders (newest + oldest)
into ONE combined extract JSON.

Reads:  nothing (entry point)
Writes: data/craigslist/01_raw_extracts/extract_full.json
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode

from tavily_client import client, stage_dir

# ----------------- CONFIG -----------------
BASE_SEARCH_URL = "https://sfbay.craigslist.org/search/sby/cta?query=camry"
OUTPUT_FILENAME = "extract_full.json"
# ------------------------------------------

LINK_ITEM_RE = re.compile(
    r'^\s*(\d+)\.\s*\[(.*?)\]\((https?://[^\)]+)\)',
    flags=re.MULTILINE | re.DOTALL
)


def strip_fragment(url: str) -> str:
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, parts.query, ""))


def set_query_param(url: str, key: str, value: str) -> str:
    parts = urlsplit(url)
    q = dict(parse_qsl(parts.query, keep_blank_values=True))
    q[key] = value
    new_query = urlencode(q, doseq=True)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, new_query, ""))


def extract_listing_id(listing_url: str) -> Optional[str]:
    m = re.search(r"/(\d{8,})\.html", listing_url)
    return m.group(1) if m else None


def listing_urls_from_raw(raw: str) -> List[str]:
    urls: List[str] = []
    for m in LINK_ITEM_RE.finditer(raw or ""):
        urls.append(m.group(3))
    return urls


def main() -> int:
    out_dir = stage_dir(1)

    base = strip_fragment(BASE_SEARCH_URL)
    newest_url = set_query_param(base, "sort", "date")
    oldest_url = set_query_param(base, "sort", "dateoldest")
    seed_urls = [newest_url, oldest_url]

    print("🌐 Tavily extract (2 URLs):")
    print(f"   newest: {newest_url}")
    print(f"   oldest: {oldest_url}")

    resp = client.extract(urls=seed_urls)
    results = resp.get("results", []) or []

    # Stats
    seen_listing_keys = set()
    for r in results:
        raw = r.get("raw_content", "") or ""
        for u in listing_urls_from_raw(raw):
            key = extract_listing_id(u) or u
            seen_listing_keys.add(key)

    output_path = out_dir / OUTPUT_FILENAME
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "base_search_url": base,
        "seed_urls": seed_urls,
        "results": results,
    }

    with output_path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)

    print(f"✅ Wrote: {output_path}")
    print(f"   Search pages stored: {len(results)}")
    print(f"   Unique listing links discovered: {len(seen_listing_keys)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())