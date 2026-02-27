#!/usr/bin/env python3
"""
Stage 2 — Parse links + titles from the combined extract JSON, write filtered CSVs.

Reads:  data/craigslist/01_raw_extracts/extract_full.json
Writes: data/craigslist/02_links/all_links.csv
        data/craigslist/02_links/toyota_camry_links.csv
"""

from __future__ import annotations

import csv
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

from tavily_client import stage_dir

# ── Paths ──
INPUT_PATH = stage_dir(1) / "extract_full.json"
OUT_DIR = stage_dir(2)
ALL_CSV = OUT_DIR / "all_links.csv"
CAMRY_CSV = OUT_DIR / "toyota_camry_links.csv"

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


def toyota_camry_flags(title: Optional[str]) -> Dict[str, bool]:
    t = (title or "").lower()
    is_camry = "camry" in t
    is_toyota = "toyota" in t
    return {
        "is_camry_keyword": is_camry,
        "is_toyota_keyword": is_toyota,
        "is_toyota_camry_title": bool(is_camry and is_toyota),
    }


def parse_payload(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
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
            flags = toyota_camry_flags(title)

            rows.append({
                "rank": rank,
                "search_url": search_url,
                "url": url,
                "title": title,
                "source_listing_id": extract_listing_id(url),
                "listing_type": extract_listing_type(url),
                **flags,
            })

    rows.sort(key=lambda r: (r.get("rank", 10**9), r.get("url", "")))

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
        "listing_type", "is_camry_keyword", "is_toyota_keyword",
        "is_toyota_camry_title",
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
        return 2

    with INPUT_PATH.open("r", encoding="utf-8") as f:
        payload = json.load(f)

    rows = parse_payload(payload)
    write_csv(ALL_CSV, rows)

    camry_rows = [r for r in rows if r.get("is_toyota_camry_title")]
    write_csv(CAMRY_CSV, camry_rows)

    print(f"✅ Input: {INPUT_PATH}")
    print(f"   All links:          {len(rows):>4} → {ALL_CSV}")
    print(f"   Toyota Camry links: {len(camry_rows):>4} → {CAMRY_CSV}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())