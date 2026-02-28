#!/usr/bin/env python3
"""
Stage 3 — Extract individual listing pages via direct HTTP scraping.

Replaces Tavily /extract with requests + BeautifulSoup.
Craigslist is server-rendered HTML — no JS execution needed.

Reads:  data/craigslist/02_links/filtered_links_{slug}.csv
Writes: data/craigslist/03_listing_pages/listing_pages_{slug}.json
        data/craigslist/03_listing_pages/listing_pages_{slug}_index.csv
        data/craigslist/03_listing_pages/listing_pages_{slug}.jsonl

Output format is identical to the Tavily version — Stage 4 is unchanged.
"""

from __future__ import annotations

import csv
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests
import random
from bs4 import BeautifulSoup

from tavily_client import stage_dir, query_slug

CAR_QUERY = os.environ.get("CAR_QUERY")
if not CAR_QUERY:
    print("ERROR: CAR_QUERY env var not set. Use run_pipeline.py.", file=sys.stderr)
    sys.exit(1)

SLUG = query_slug(CAR_QUERY)

# ── Paths ──
INPUT_CSV         = stage_dir(2) / f"filtered_links_{SLUG}.csv"
OUT_DIR           = stage_dir(3)
OUTPUT_JSON       = OUT_DIR / f"listing_pages_{SLUG}.json"
OUTPUT_INDEX_CSV  = OUT_DIR / f"listing_pages_{SLUG}_index.csv"
OUTPUT_JSONL      = OUT_DIR / f"listing_pages_{SLUG}.jsonl"

# ── Scraper settings ──
# 4 workers + 0.5-1.5s jitter = ~4-6 req/sec, safe for CL
MAX_WORKERS           = 4
REQUEST_TIMEOUT       = (5, 15)  # (connect timeout, read timeout)
MAX_RETRIES           = 3
RETRY_BACKOFF         = 3       # seconds, doubles each retry
SNIPPET_CHARS         = 220

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

LISTING_ID_RE = re.compile(r"/(\d{8,})\.html")


# ═══════════════════════════════════════════════════════════════════
#  HTML → structured text
#  Produces the same markdown-like text format Stage 4 expects:
#    # Title
#    key: value   (CL attribute block)
#    body text
# ═══════════════════════════════════════════════════════════════════

def parse_listing_page(html: str, url: str) -> Dict[str, Any]:
    """Extract raw_content text and image URLs from a CL listing page."""
    soup = BeautifulSoup(html, "html.parser")
    parts: List[str] = []

    # ── Navigation breadcrumb (gives region context) ──
    breadcrumb = soup.select_one("#breadcrumbs")
    if breadcrumb:
        crumbs = [a.get_text(strip=True) for a in breadcrumb.find_all("a")]
        if crumbs:
            parts.append(" > ".join(crumbs))

    # ── Posted / updated dates ──
    # CL renders these in <time> tags with datetime attribute
    for time_tag in soup.select("p.postinginfo time"):
        label_el = time_tag.parent
        label_text = label_el.get_text(" ", strip=True).lower()
        dt = time_tag.get("datetime", "")
        if "post" in label_text:
            parts.append(f"posted: {dt}")
        elif "updat" in label_text:
            parts.append(f"updated: {dt}")

    # ── Title (as markdown header so Stage 4's CL_HEADER_RE matches) ──
    title_el    = soup.select_one("#titletextonly") or soup.select_one(".postingtitletext")
    price_el    = soup.select_one(".price")
    location_el = soup.select_one(".postingtitletext small")

    title_text    = title_el.get_text(strip=True)    if title_el    else ""
    price_text    = price_el.get_text(strip=True)    if price_el    else ""
    location_text = location_el.get_text(strip=True) if location_el else ""

    if title_text:
        header = title_text
        if price_text:
            header += f" - {price_text}"
        if location_text:
            header += f" {location_text}"
        parts.append(f"# {header}")

    # ── CL attribute block ──
    # Rendered as <p class="attrgroup"> containing <span> elements
    for attrgroup in soup.select(".attrgroup"):
        for span in attrgroup.find_all("span"):
            text = span.get_text(" ", strip=True)
            if text:
                parts.append(text)

    # ── Google Maps coordinates ──
    map_link = soup.find("a", href=re.compile(r"google\.com/maps/search/"))
    if map_link:
        parts.append(map_link["href"])

    # ── Posting body ──
    body_el = soup.select_one("#postingbody")
    if body_el:
        for tag in body_el.select(".print-qrcode-container"):
            tag.decompose()
        body_text = body_el.get_text("\n", strip=True)
        if body_text:
            parts.append(body_text)

    # ── Post ID and footer metadata ──
    for info in soup.select(".postinginfo"):
        text = info.get_text(" ", strip=True)
        if text:
            parts.append(text)

    # ── Image URLs ──
    images: List[str] = []
    for img in soup.select(".swipe-wrap img, #thumbs img, .gallery img"):
        src = img.get("src") or img.get("data-src") or ""
        src = re.sub(r"_\d+x\d+\.jpg$", "_600x450.jpg", src)
        if src and "50x50" not in src and src not in images:
            images.append(src)
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(script.string or "")
            if isinstance(data, dict):
                for img in data.get("image", []):
                    if isinstance(img, str) and img not in images:
                        images.append(img)
        except (json.JSONDecodeError, TypeError):
            pass

    raw_content = "\n\n".join(parts)
    return {"raw_content": raw_content, "images": images}


# ═══════════════════════════════════════════════════════════════════
#  HTTP fetch with retry — one session per thread to avoid races
# ═══════════════════════════════════════════════════════════════════

def fetch_url(url: str, session: requests.Session) -> tuple[Optional[str], Optional[str]]:
    """Fetch URL, return (html, error). Retries on transient failures."""
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = session.get(url, timeout=REQUEST_TIMEOUT)
            if resp.status_code == 200:
                return resp.text, None
            if resp.status_code == 404:
                return None, "404 not found"
            if resp.status_code in (403, 429):
                wait = RETRY_BACKOFF * (2 ** attempt)
                print(f"  ⚠️  {resp.status_code} on attempt {attempt}, waiting {wait}s...")
                time.sleep(wait)
                continue
            return None, f"http_{resp.status_code}"
        except requests.exceptions.Timeout:
            if attempt == MAX_RETRIES:
                return None, "timeout"
            time.sleep(RETRY_BACKOFF * attempt)
        except requests.exceptions.RequestException as e:
            if attempt == MAX_RETRIES:
                return None, str(e)
            time.sleep(RETRY_BACKOFF * attempt)
    return None, "max_retries_exceeded"


def fetch_and_parse(url: str) -> Dict[str, Any]:
    """Fetch and parse a single listing. Each call creates its own session."""
    # Per-thread session avoids shared state race conditions
    session = requests.Session()
    session.headers.update(HEADERS)

    time.sleep(random.uniform(0.4, 1.2))

    html, error = fetch_url(url, session)
    if error or not html:
        return {"url": url, "raw_content": "", "images": [], "error": error or "empty_response"}
    parsed = parse_listing_page(html, url)
    return {
        "url":         url,
        "raw_content": parsed["raw_content"],
        "images":      parsed["images"],
        "error":       "",
    }


# ═══════════════════════════════════════════════════════════════════
#  Helpers
# ═══════════════════════════════════════════════════════════════════

def extract_listing_id(url: str) -> str:
    m = LISTING_ID_RE.search(url or "")
    return m.group(1) if m else ""


def read_urls(csv_path: Path) -> List[str]:
    with csv_path.open("r", encoding="utf-8") as f:
        r = csv.DictReader(f)
        return [row["url"].strip() for row in r if row.get("url")]


def snippet(text: Optional[str], n: int = SNIPPET_CHARS) -> str:
    if not text:
        return ""
    s = text.replace("\r", " ").replace("\n", " ").strip()
    return s if len(s) <= n else (s[:n] + "…")


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
            w.writerow({
                "listing_id":          extract_listing_id(url),
                "url":                 url,
                "raw_content_chars":   len(raw),
                "content_chars":       0,
                "has_raw_content":     bool(raw),
                "error":               r.get("error") or "",
                "raw_content_snippet": snippet(raw),
            })


def write_normalized_jsonl(
    path: Path, results: List[Dict[str, Any]], source_csv: Path
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for r in results:
            url = r.get("url", "") or ""
            rec = {
                "listing_id":   extract_listing_id(url),
                "url":          url,
                "source_csv":   str(source_csv),
                "extracted_at": datetime.now(timezone.utc).isoformat(),
                "error":        r.get("error") or "",
                "raw_content":  r.get("raw_content") or "",
                "content":      "",
                "image_urls":   r.get("images") or [],   # ← passed through for Stage 4
                "tavily_meta":  {},
            }
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")


# ═══════════════════════════════════════════════════════════════════
#  Main
# ═══════════════════════════════════════════════════════════════════

def main() -> int:
    if not INPUT_CSV.exists():
        raise SystemExit(f"Missing input: {INPUT_CSV}\nRun Stage 2 first.")

    urls = read_urls(INPUT_CSV)
    total = len(urls)
    est_seconds = round((total / MAX_WORKERS) * 1.3)
    print(f"📋 {total} listing URLs to scrape for \"{CAR_QUERY}\"")
    print(f"   {MAX_WORKERS} workers, ~0.8s avg delay  (~{est_seconds}s estimated)")

    all_results: List[Dict[str, Any]] = []
    completed = 0
    errors = 0

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {executor.submit(fetch_and_parse, url): url for url in urls}
        for future in as_completed(futures):
            result = future.result()
            all_results.append(result)
            completed += 1
            if result.get("error"):
                errors += 1
            if completed % 50 == 0 or completed == total:
                print(f"  📄 {completed}/{total}  (errors: {errors})")

    # ── Write outputs ──
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "query":        CAR_QUERY,
        "source_csv":   str(INPUT_CSV),
        "results":      all_results,
    }
    with OUTPUT_JSON.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)

    write_index_csv(OUTPUT_INDEX_CSV, all_results)
    write_normalized_jsonl(OUTPUT_JSONL, all_results, INPUT_CSV)

    success = total - errors
    print(f"\n✅ Scraped {success}/{total} listing pages  ({errors} errors)")
    print(f"   Listing pages JSON:  {OUTPUT_JSON}")
    print(f"   Index CSV:           {OUTPUT_INDEX_CSV}")
    print(f"   Normalized JSONL:    {OUTPUT_JSONL}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())