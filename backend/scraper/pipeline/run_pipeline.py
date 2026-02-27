#!/usr/bin/env python3
"""
Run the full scraping pipeline: Stage 1 → 2 → 3 → 4

Usage:
    python run_pipeline.py "honda civic"                # search for civic
    python run_pipeline.py "toyota camry" --stages 3 4  # rerun stages 3-4 only
    python run_pipeline.py                              # interactive prompt
"""

import argparse
import os
import subprocess
import sys
import time
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parent

STAGES = [
    (1, "stage_01_harvest_search.py",              "Harvesting search pages (Tavily Search)"),
    (2, "stage_02_parse_links.py",                 "Parsing links from extracts"),
    (3, "stage_03_extract_listing_pages_tavily.py", "Scraping individual listings (BeautifulSoup)"),
    (4, "stage_04_parse_structured.py",            "Parsing structured fields"),
    (5, "stage_05_research.py",                    "Researching reliability & market value (Tavily Search)"),
]


def main() -> int:
    parser = argparse.ArgumentParser(description="Run car scraping pipeline")
    parser.add_argument("query", nargs="?", default=None,
                        help='Search query, e.g. "honda civic"')
    parser.add_argument("--stages", nargs="*", type=int,
                        help="Only run these stage numbers (default: all)")
    args = parser.parse_args()

    query = args.query
    if not query:
        query = input("🔍 What car are you looking for? (e.g. honda civic): ").strip()
        if not query:
            print("No query provided. Exiting.")
            return 1

    only = set(args.stages) if args.stages else {s[0] for s in STAGES}

    env = os.environ.copy()
    env["CAR_QUERY"] = query

    print(f"\n  🔍 Query: \"{query}\"")

    start = time.time()

    for num, filename, desc in STAGES:
        if num not in only:
            continue

        print(f"\n{'='*60}")
        print(f"  Stage {num}: {desc}")
        print(f"{'='*60}\n")

        result = subprocess.run(
            [sys.executable, str(PIPELINE_DIR / filename)],
            cwd=str(PIPELINE_DIR),
            env=env,
        )

        if result.returncode != 0:
            print(f"\n❌ Stage {num} failed (exit {result.returncode}). Stopping.")
            return result.returncode

    elapsed = time.time() - start
    print(f"\n{'='*60}")
    print(f"  ✅ Pipeline complete in {elapsed:.1f}s")
    print(f"{'='*60}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())