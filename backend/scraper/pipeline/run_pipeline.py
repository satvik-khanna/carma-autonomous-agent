#!/usr/bin/env python3
"""
Run the full scraping pipeline: Stage 1 → 2 → 3 → 4

Usage:
    python run_pipeline.py              # run all stages
    python run_pipeline.py 3 4          # run only stages 3 and 4 (e.g. after editing parser)
"""

import subprocess
import sys
import time
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parent

STAGES = [
    (1, "stage_01_harvest_search.py",        "Harvesting search pages"),
    (2, "stage_02_parse_links.py",           "Parsing links from extracts"),
    (3, "stage_03_extract_listing_pages.py", "Extracting individual listings"),
    (4, "stage_04_parse_structured.py",      "Parsing structured fields"),
]


def main() -> int:
    # If args given, only run those stage numbers
    if len(sys.argv) > 1:
        only = {int(a) for a in sys.argv[1:]}
    else:
        only = {s[0] for s in STAGES}

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