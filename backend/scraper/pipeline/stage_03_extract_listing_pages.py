#!/usr/bin/env python3
"""
Stage 3 — Enrich listing pages by calling Tavily /extract on listing URLs.

Reads:  data/craigslist/02_links/filtered_links_{slug}.csv
Writes: data/craigslist/03_listing_pages/listing_pages_{slug}.json
        data/craigslist/03_listing_pages/listing_pages_{slug}_index.csv
        data/craigslist/03_listing_pages/listing_pages_{slug}.jsonl
"""

from __future__ import annotations

import csv
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from tavily_client import client, stage_dir, query_slug

CAR_QUERY = os.environ.get("CAR_QUERY")
if not CAR_QUERY:
    print("ERROR: CAR_QUERY env var not set. Use run_pipeline.py.", file=sys.stderr)
    sys.exit(1)

SLUG = query_slug(CAR_QUERY)

# ── Paths ──
INPUT_CSV = stage_dir(2) / f"filtered_links_{SLUG}.csv"
OUT_DIR = stage_dir(3)
OUTPUT_JSON = OUT_DIR / f"listing_pages_{SLUG}.json"
OUTPUT_INDEX_CSV = OUT_DIR / f"listing_pages_{SLUG}_index.csv"
OUTPUT_JSONL = OUT_DIR / f"listing_pages_{SLUG}.jsonl"

TAVILY_URLS_PER_CALL = 20
SLEEP_SECONDS = 0.0
MAX_CALLS = 500
SNIPPET_CHARS = 220

LISTING_ID_RE = re.compile(r"/(\d{8,})\.html")


def extract_listing_id(url: str) -> str:
    m = LISTING_ID_RE.search(url or "")
    return m.group(1) if m else ""


def read_urls(csv_path: Path) -> List[str]:
    with csv_path.open("r", encoding="utf-8") as f:
        r = csv.DictReader(f)
        return [row["url"].strip() for row in r if row.get("url")]


def chunk(lst: List[str], n: int) -> List[List[str]]:
    return [lst[i:i + n] for i in range(0, len(lst), n)]


def safe_len(x: Any) -> int:
    if not x:
        return 0
    if isinstance(x, str):
        return len(x)
    try:
        return len(json.dumps(x, ensure_ascii=False))
    except Exception:
        return 0


def snippet(text: Optional[str], n: int = SNIPPET_CHARS) -> str:
    if not text:
        return ""
    s = text.replace("\r", " ").replace("\n", " ").strip()
    return s if len(s) <= n else (s[:n] + "…")


def infer_error(result: Dict[str, Any]) -> str:
    for k in ("error", "errors", "message", "detail"):
        v = result.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
        if isinstance(v, list) and v:
            return str(v[0])
        if isinstance(v, dict) and v:
            return str(v)
    return ""


def write_index_csv(path: Path, results: List[Dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "listing_id", "url", "raw_content_chars", "content_chars",
        "has_raw_content", "error", "raw_content_snippet",
    ]

    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in results:
            url = r.get("url", "") or ""
            raw = r.get("raw_content") or ""
            content = r.get("content") or ""
            w.writerow({
                "listing_id": extract_listing_id(url),
                "url": url,
                "raw_content_chars": safe_len(raw),
                "content_chars": safe_len(content),
                "has_raw_content": bool(safe_len(raw) > 0),
                "error": infer_error(r),
                "raw_content_snippet": snippet(raw if isinstance(raw, str) else "", SNIPPET_CHARS),
            })


def write_normalized_jsonl(path: Path, results: List[Dict[str, Any]], source_csv: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for r in results:
            url = r.get("url", "") or ""
            rec = {
                "listing_id": extract_listing_id(url),
                "url": url,
                "source_csv": str(source_csv),
                "extracted_at": datetime.now(timezone.utc).isoformat(),
                "error": infer_error(r),
                "raw_content": r.get("raw_content") or "",
                "content": r.get("content") or "",
                "tavily_meta": {k: v for k, v in r.items() if k not in ("raw_content", "content")},
            }
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")


def main() -> int:
    if not INPUT_CSV.exists():
        raise SystemExit(f"Missing input: {INPUT_CSV}\nRun Stage 2 first.")

    urls = read_urls(INPUT_CSV)
    print(f"📋 {len(urls)} listing URLs to extract for \"{CAR_QUERY}\"")

    batches = chunk(urls, TAVILY_URLS_PER_CALL)
    all_results: List[Dict[str, Any]] = []

    for idx, b in enumerate(batches[:MAX_CALLS], start=1):
        print(f"📄 Extracting batch {idx}/{len(batches)} ({len(b)} urls)")
        resp = client.extract(urls=b, extract_depth="advanced", timeout=120)
        all_results.extend(resp.get("results", []) or [])
        if SLEEP_SECONDS > 0:
            time.sleep(SLEEP_SECONDS)

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "query": CAR_QUERY,
        "source_csv": str(INPUT_CSV),
        "results": all_results,
    }

    with OUTPUT_JSON.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)

    write_index_csv(OUTPUT_INDEX_CSV, all_results)
    write_normalized_jsonl(OUTPUT_JSONL, all_results, INPUT_CSV)

    print(f"✅ Wrote listing pages:  {OUTPUT_JSON}")
    print(f"   Index CSV:            {OUTPUT_INDEX_CSV}")
    print(f"   Normalized JSONL:     {OUTPUT_JSONL}")
    print(f"   Total pages stored:   {len(all_results)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())