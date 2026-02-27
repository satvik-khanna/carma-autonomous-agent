#!/usr/bin/env python3
"""
Stage 1 — Harvest Craigslist search results across NorCal using
price-bucket strategy with relevance sort only.

Each CL search page caps at ~217 visible results. Price bucketing
ensures each bucket stays under that cap for full coverage.

Reads:  CAR_QUERY env var (required)
Writes: data/craigslist/01_raw_extracts/extract_full_{slug}.json
"""

from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote_plus, urlencode

from tavily_client import client, stage_dir, query_slug

CAR_QUERY = os.environ.get("CAR_QUERY")
if not CAR_QUERY:
    print("ERROR: CAR_QUERY env var not set. Use run_pipeline.py.", file=sys.stderr)
    sys.exit(1)

SLUG = query_slug(CAR_QUERY)

# ── Search strategy: site → list of (min_price, max_price) buckets ──
# None means no bound. All use sort=rel (relevance).
#
# Bucket sizes were manually verified across multiple car types
# (BMW M3, Mercedes AMG, Honda Civic/Accord, Toyota Camry).

SEARCH_PLAN: List[Tuple[str, Optional[str], List[Tuple[Optional[int], Optional[int]]]]] = [
    # (hostname, sub-region or None, [(min_price, max_price), ...])

    # SF Bay Area — whole site, split by price
    ("sfbay", None, [
        (None, 9000),
        (9000, 15000),
        (15000, 25000),
        (25000, None),
    ]),

    # Sacramento — no sub-regions available, aggressive price bucketing
    ("sacramento", None, [
        (None, 10000),
        (10000, 15000),
        (15000, 20000),
        (20000, None),
    ]),

    # Stockton — moderate volume, 2 buckets
    ("stockton", None, [
        (None, 15000),
        (15000, None),
    ]),

    # Modesto — small enough, no bucketing needed
    ("modesto", None, [
        (None, None),
    ]),

    # Monterey — small enough, no bucketing needed
    ("monterey", None, [
        (None, None),
    ]),
]

TAVILY_BATCH_SIZE = 20

LINK_ITEM_RE = re.compile(
    r'^\s*(\d+)\.\s*\[(.*?)\]\((https?://[^\)]+)\)',
    flags=re.MULTILINE | re.DOTALL
)


def build_url(
    query: str,
    hostname: str,
    subregion: Optional[str],
    min_price: Optional[int],
    max_price: Optional[int],
) -> str:
    """Build a CL search URL with sort=rel and optional price bounds."""
    if subregion:
        path = f"/search/{subregion}/cta"
    else:
        path = "/search/cta"

    params: Dict[str, str] = {
        "query": query,
        "sort": "rel",
    }
    if min_price is not None:
        params["min_price"] = str(min_price)
    if max_price is not None:
        params["max_price"] = str(max_price)

    qs = urlencode(params)
    return f"https://{hostname}.craigslist.org{path}?{qs}"


def price_label(min_p: Optional[int], max_p: Optional[int]) -> str:
    if min_p is None and max_p is None:
        return "all prices"
    if min_p is None:
        return f"<${max_p:,}"
    if max_p is None:
        return f"${min_p:,}+"
    return f"${min_p:,}–${max_p:,}"


def extract_listing_id(listing_url: str) -> Optional[str]:
    m = re.search(r"/(\d{8,})\.html", listing_url)
    return m.group(1) if m else None


def listing_urls_from_raw(raw: str) -> List[str]:
    return [m.group(3) for m in LINK_ITEM_RE.finditer(raw or "")]


def chunk(lst: List[str], n: int) -> List[List[str]]:
    return [lst[i:i + n] for i in range(0, len(lst), n)]


def main() -> int:
    out_dir = stage_dir(1)

    # Build all seed URLs from the search plan
    seed_urls: List[str] = []
    url_labels: List[str] = []

    for hostname, subregion, buckets in SEARCH_PLAN:
        for min_p, max_p in buckets:
            url = build_url(CAR_QUERY, hostname, subregion, min_p, max_p)
            seed_urls.append(url)
            label = f"{hostname}" + (f"/{subregion}" if subregion else "")
            url_labels.append(f"{label} ({price_label(min_p, max_p)})")

    batches = chunk(seed_urls, TAVILY_BATCH_SIZE)

    print(f"🔍 Query: \"{CAR_QUERY}\"")
    print(f"🌐 {len(seed_urls)} search URLs across {len(SEARCH_PLAN)} sites")
    for label in url_labels:
        print(f"   • {label}")
    print(f"   Tavily calls needed: {len(batches)}")

    # Extract all search pages
    all_results: List[Dict[str, Any]] = []
    for i, batch in enumerate(batches, start=1):
        print(f"   📡 Extract call {i}/{len(batches)} ({len(batch)} URLs)")
        resp = client.extract(urls=batch)
        all_results.extend(resp.get("results", []) or [])

    # Count unique listings discovered
    seen_listing_keys = set()
    for r in all_results:
        raw = r.get("raw_content", "") or ""
        for u in listing_urls_from_raw(raw):
            key = extract_listing_id(u) or u
            seen_listing_keys.add(key)

    # Save with query slug in filename
    output_path = out_dir / f"extract_full_{SLUG}.json"
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "query": CAR_QUERY,
        "search_plan": [
            {
                "hostname": h,
                "subregion": s,
                "price_buckets": [{"min": mn, "max": mx} for mn, mx in b],
            }
            for h, s, b in SEARCH_PLAN
        ],
        "seed_urls": seed_urls,
        "results": all_results,
    }

    with output_path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)

    print(f"✅ Wrote: {output_path}")
    print(f"   Search pages returned: {len(all_results)}/{len(seed_urls)}")
    print(f"   Unique listing links discovered: {len(seen_listing_keys)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())