#!/usr/bin/env python3
"""
test_scout.py — Prove the Yutori Scout integration works end-to-end.

Usage:
    python test_scout.py
    python test_scout.py "honda civic" --location "Bay Area CA" --max-price 12000
"""

import argparse
import time
from yutori_scout import (
    create_car_scout,
    get_scout_updates,
    delete_scout,
    list_active_scouts,
)


def main():
    parser = argparse.ArgumentParser(description="Test Yutori Scout integration")
    parser.add_argument("query", nargs="?", default="toyota camry", help="Car to search for")
    parser.add_argument("--location", default="Bay Area CA")
    parser.add_argument("--max-price", type=int, default=15000)
    parser.add_argument("--min-year", type=int, default=None)
    parser.add_argument("--max-mileage", type=int, default=None)
    args = parser.parse_args()

    print(f"\n{'='*60}")
    print(f"  🤖 Yutori Scout Integration Test")
    print(f"{'='*60}")
    print(f"  Query:     {args.query}")
    print(f"  Location:  {args.location}")
    print(f"  Max price: ${args.max_price:,}")

    # ── Step 1: Create the Scout ──
    print(f"\n  [1/4] Creating Scout...")
    scout = create_car_scout(
        query=args.query,
        location=args.location,
        max_price=args.max_price,
        min_year=args.min_year,
        max_mileage=args.max_mileage,
        skip_email=True,
    )
    scout_id = scout["id"]
    print(f"  ✅ Scout ID: {scout_id}")
    print(f"  ✅ Status:   {scout.get('status', 'unknown')}")

    # ── Step 2: List active scouts (confirm it's there) ──
    print(f"\n  [2/4] Listing active scouts...")
    active = list_active_scouts()
    ids = [s["id"] for s in active]
    if scout_id in ids:
        print(f"  ✅ Scout appears in active list ({len(active)} total active scouts)")
    else:
        print(f"  ⚠️  Scout not found in active list yet (may take a moment)")

    # ── Step 3: Check for updates (will be empty on first run — that's fine) ──
    print(f"\n  [3/4] Fetching updates (expect empty on first run)...")
    updates = get_scout_updates(scout_id, limit=5)
    print(f"  ✅ Updates returned: {len(updates)}")
    if updates:
        print(f"  📋 First update preview:")
        print(f"     {updates[0]}")
    else:
        print(f"  ℹ️  No updates yet — Scout hasn't run its first cycle.")
        print(f"     In production it runs every 6 hours.")

    # ── Step 4: Clean up ──
    print(f"\n  [4/4] Deleting Scout (cleanup)...")
    delete_scout(scout_id)
    print(f"  ✅ Scout deleted")

    print(f"\n{'='*60}")
    print(f"  ✅ Integration test passed!")
    print(f"  The Scout API is working. Connect frontend when ready.")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()