#!/usr/bin/env python3
"""
Run the scraping pipeline: Stage 1 → 2 → 3 → 4 → 5

Usage:
    python run_pipeline.py "honda civic"                # stages 1-5
    python run_pipeline.py "toyota camry" --stages 3 4  # rerun stages 3-4
    python run_pipeline.py "lexus is350" --all-stages   # include stage 6 (expansion)
    python run_pipeline.py                              # interactive prompt
"""

import argparse
import os
import subprocess
import sys
import time
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = PIPELINE_DIR.parent.parent.parent

STAGES = [
    (1, "stage_01_harvest_search.py",              "Harvesting search pages (Tavily Search)"),
    (2, "stage_02_parse_links.py",                 "Parsing links from extracts"),
    (3, "stage_03_extract_listing_pages.py", "Scraping individual listings (BeautifulSoup)"),
    (4, "stage_04_parse_structured.py",            "Parsing structured fields"),
    (5, "stage_05_research.py",                    "Researching reliability & market value (Tavily Search)"),
    (6, "stage_06_expand_search.py",               "Expansion Agent — finds alternatives if results < 20 (OpenAI)"),
]

DEFAULT_STAGES = {1, 2, 3, 4, 5}


def slugify(query: str) -> str:
    import re
    return re.sub(r"[^a-z0-9]+", "_", query.lower().strip()).strip("_")


def main() -> int:
    parser = argparse.ArgumentParser(description="Run car scraping pipeline")
    parser.add_argument("query", nargs="?", default=None,
                        help='Search query, e.g. "honda civic"')
    parser.add_argument("--stages", nargs="*", type=int,
                        help="Only run these stage numbers (default: 1-5)")
    parser.add_argument("--all-stages", action="store_true",
                        help="Include stage 6 (expansion agent)")
    args = parser.parse_args()

    query = args.query
    if not query:
        query = input("🔍 What car are you looking for? (e.g. honda civic): ").strip()
        if not query:
            print("No query provided. Exiting.")
            return 1

    if args.stages:
        only = set(args.stages)
    elif args.all_stages:
        only = {s[0] for s in STAGES}
    else:
        only = DEFAULT_STAGES

    env = os.environ.copy()
    env["CAR_QUERY"] = query

    stage_list = ", ".join(str(s) for s in sorted(only))
    print(f"\n  🔍 Query: \"{query}\"")
    print(f"  📋 Stages: {stage_list}")

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