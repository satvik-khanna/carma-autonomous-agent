#!/usr/bin/env python3
"""
Stage 2 — Parse links + titles from the combined extract JSON, write filtered CSVs.

Reads:  data/craigslist/01_raw_extracts/extract_full_{slug}.json
        CAR_QUERY env var for filtering
Writes: data/craigslist/02_links/all_links_{slug}.csv
        data/craigslist/02_links/filtered_links_{slug}.csv
"""

from __future__ import annotations

import csv
import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

from tavily_client import stage_dir, query_slug

# ── Query ──
CAR_QUERY = os.environ.get("CAR_QUERY")
if not CAR_QUERY:
    print("ERROR: CAR_QUERY env var not set. Use run_pipeline.py.", file=sys.stderr)
    sys.exit(1)

SLUG = query_slug(CAR_QUERY)

# ── Paths ──
INPUT_PATH = stage_dir(1) / f"extract_full_{SLUG}.json"
OUT_DIR = stage_dir(2)
ALL_CSV = OUT_DIR / f"all_links_{SLUG}.csv"
FILTERED_CSV = OUT_DIR / f"filtered_links_{SLUG}.csv"

LINK_ITEM_RE = re.compile(
    r"^\s*(\d+)\.\s*\[(.*?)\]\((https?://[^\)]+)\)",
    flags=re.MULTILINE | re.DOTALL,
)


def extract_listing_id(url: str) -> Optional[str]:
    m = re.search(r"/(\d{8,})\.html", url)
    return m.group(1) if m else None


def extract_listing_type(url: str) -> Optional[str]:
    m = re.search(r"/(cto|ctd)/", url)
    return m.group(1) if m else None


def title_from_bracket_text(bracket_text: str) -> Optional[str]:
    lines = [
        ln.strip()
        for ln in (bracket_text or "").replace("\r", "").split("\n")
        if ln.strip()
    ]
    return lines[0] if lines else None


def title_matches_query(title: Optional[str], query: str) -> bool:
    """Check if title contains ALL keywords from the query."""
    if not title:
        return False
    t = title.lower()
    keywords = query.lower().split()
    return all(kw in t for kw in keywords)


def parse_payload(payload: Dict[str, Any], query: str) -> List[Dict[str, Any]]:
    results = payload.get("results", [])
    if not isinstance(results, list) or not results:
        raise ValueError("Input JSON has no 'results' array (or it's empty).")

    rows: List[Dict[str, Any]] = []
    for res in results:
        search_url = (res or {}).get("url") or ""
        raw = (res or {}).get("raw_content") or ""

        for m in LINK_ITEM_RE.finditer(raw):
            rank = int(m.group(1))
            bracket_text = m.group(2) or ""
            url = m.group(3)

            title = title_from_bracket_text(bracket_text)

            rows.append({
                "rank": rank,
                "search_url": search_url,
                "url": url,
                "title": title,
                "source_listing_id": extract_listing_id(url),
                "listing_type": extract_listing_type(url),
                "matches_query": title_matches_query(title, query),
            })

    rows.sort(key=lambda r: (r.get("rank", 10**9), r.get("url", "")))

    # Dedupe by listing ID (same car from different price buckets)
    seen = set()
    deduped: List[Dict[str, Any]] = []
    for r in rows:
        key = r.get("source_listing_id") or r["url"]
        if key in seen:
            continue
        seen.add(key)
        deduped.append(r)

    return deduped


def write_csv(path: Path, rows: List[Dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "rank", "search_url", "url", "title", "source_listing_id",
        "listing_type", "matches_query",
    ]

    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k) for k in fieldnames})


def main() -> int:
    if not INPUT_PATH.exists():
        print(f"ERROR: Input not found: {INPUT_PATH}", file=sys.stderr)
        print("Run Stage 1 first.", file=sys.stderr)
        return 1

    with INPUT_PATH.open("r", encoding="utf-8") as f:
        payload = json.load(f)

    print(f"🔍 Filtering for: \"{CAR_QUERY}\"")

    rows = parse_payload(payload, CAR_QUERY)
    write_csv(ALL_CSV, rows)

    filtered_rows = [r for r in rows if r.get("matches_query")]
    write_csv(FILTERED_CSV, filtered_rows)

    print(f"✅ Input: {INPUT_PATH}")
    print(f"   All links:      {len(rows):>4} → {ALL_CSV}")
    print(f"   Matching query: {len(filtered_rows):>4} → {FILTERED_CSV}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())