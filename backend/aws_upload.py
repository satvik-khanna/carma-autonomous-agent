#!/usr/bin/env python3
"""
aws_upload.py — Upload pipeline data to AWS (S3 + DynamoDB)

Uploads:
  - All pipeline stage files → S3 (bulk storage, organized by stage)
  - Enriched/structured listings → DynamoDB (queryable by search slug)

Usage:
    python aws_upload.py                      # upload everything
    python aws_upload.py --slug 2014_toyota_camry   # upload one search only
    python aws_upload.py --s3-only            # skip DynamoDB
    python aws_upload.py --dynamo-only        # skip S3
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from decimal import Decimal
from pathlib import Path

import boto3
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env.local")

AWS_REGION = os.getenv("AWS_REGION", "us-east-2")
S3_BUCKET = os.getenv("S3_BUCKET_NAME", "carma-pipeline-data")
DYNAMO_TABLE = os.getenv("DYNAMODB_TABLE_NAME", "carma-listings")

DATA_ROOT = Path(__file__).resolve().parent / "data" / "craigslist"

STAGE_DIRS = [
    "01_raw_extracts",
    "02_links",
    "03_listing_pages",
    "04_structured",
    "05_research",
    "06_expanded",
]


def get_aws_clients():
    session = boto3.Session(
        aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
        region_name=AWS_REGION,
    )
    return session.client("s3"), session.resource("dynamodb")


def float_to_decimal(obj):
    """DynamoDB doesn't support float — convert to Decimal recursively."""
    if isinstance(obj, float):
        return Decimal(str(obj))
    if isinstance(obj, dict):
        return {k: float_to_decimal(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [float_to_decimal(i) for i in obj]
    return obj


def extract_slug_from_filename(filename: str) -> str | None:
    """Extract the search slug from a pipeline filename."""
    patterns = [
        r"extract_full_(.+)\.json",
        r"all_links_(.+)\.csv",
        r"filtered_links_(.+)\.csv",
        r"listing_pages_(.+?)(?:_index)?\.(?:json|jsonl|csv)",
        r"listings_(?:enriched|structured)_(.+)\.(?:json|jsonl|csv)",
        r"research_(.+)\.json",
        r"expanded_(.+)\.json",
    ]
    for pat in patterns:
        m = re.match(pat, filename)
        if m:
            return m.group(1)
    return None


# ── S3 upload ────────────────────────────────────────────────────────────────

def upload_to_s3(s3_client, slug_filter: str | None = None):
    """Upload all pipeline files to S3, organized by stage directory."""
    uploaded = 0
    skipped = 0

    for stage_dir in STAGE_DIRS:
        stage_path = DATA_ROOT / stage_dir
        if not stage_path.exists():
            continue

        for fpath in sorted(stage_path.iterdir()):
            if fpath.is_dir():
                continue

            if slug_filter:
                slug = extract_slug_from_filename(fpath.name)
                if slug and slug != slug_filter:
                    skipped += 1
                    continue

            s3_key = f"craigslist/{stage_dir}/{fpath.name}"
            print(f"  S3 ↑ {s3_key}")
            s3_client.upload_file(str(fpath), S3_BUCKET, s3_key)
            uploaded += 1

    print(f"\n  S3: {uploaded} files uploaded, {skipped} skipped")
    return uploaded


# ── DynamoDB upload ──────────────────────────────────────────────────────────

def upload_to_dynamodb(dynamo_resource, slug_filter: str | None = None):
    """Upload enriched/structured listings to DynamoDB."""
    table = dynamo_resource.Table(DYNAMO_TABLE)
    uploaded = 0
    errors = 0

    structured_dir = DATA_ROOT / "04_structured"
    if not structured_dir.exists():
        print("  No 04_structured directory found")
        return 0

    json_files = sorted(structured_dir.glob("*.json"))

    # Upload structured first, then enriched — so enriched overwrites with richer data
    structured_first = sorted(json_files, key=lambda f: (f.name.startswith("listings_enriched_"), f.name))

    enriched_slugs = set()
    for fpath in json_files:
        if fpath.name.startswith("listings_enriched_"):
            s = extract_slug_from_filename(fpath.name)
            if s:
                enriched_slugs.add(s)

    for fpath in structured_first:
        slug = extract_slug_from_filename(fpath.name)
        if not slug:
            continue
        if slug_filter and slug != slug_filter:
            continue

        is_enriched = fpath.name.startswith("listings_enriched_")
        is_structured = fpath.name.startswith("listings_structured_")
        if not (is_enriched or is_structured):
            continue

        # Skip structured files when we have enriched data for the same slug
        if is_structured and slug in enriched_slugs:
            print(f"\n  Skipping {fpath.name} (enriched version exists)")
            continue

        with open(fpath) as f:
            listings = json.load(f)

        if not isinstance(listings, list):
            continue

        print(f"\n  DynamoDB ↑ {fpath.name} ({len(listings)} listings)")

        with table.batch_writer() as batch:
            for listing in listings:
                listing_id = listing.get("id") or listing.get("url", "unknown")
                item = float_to_decimal(listing)
                item["pk"] = slug
                item["sk"] = listing_id
                item["data_type"] = "enriched" if is_enriched else "structured"
                item["uploaded_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

                try:
                    batch.put_item(Item=item)
                    uploaded += 1
                except Exception as e:
                    print(f"    ✗ {listing_id}: {e}")
                    errors += 1

    # Also upload research data as separate items
    research_dir = DATA_ROOT / "05_research"
    if research_dir.exists():
        for fpath in sorted(research_dir.glob("research_*.json")):
            slug = extract_slug_from_filename(fpath.name)
            if not slug:
                continue
            if slug_filter and slug != slug_filter:
                continue

            with open(fpath) as f:
                research = json.load(f)

            item = float_to_decimal(research)
            item["pk"] = slug
            item["sk"] = f"_research_{slug}"
            item["data_type"] = "research"
            item["uploaded_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

            try:
                table.put_item(Item=item)
                uploaded += 1
                print(f"  DynamoDB ↑ research for {slug}")
            except Exception as e:
                print(f"    ✗ research {slug}: {e}")
                errors += 1

    print(f"\n  DynamoDB: {uploaded} items uploaded, {errors} errors")
    return uploaded


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(description="Upload pipeline data to AWS")
    parser.add_argument("--slug", default=None, help="Only upload data for this search slug")
    parser.add_argument("--s3-only", action="store_true", help="Only upload to S3")
    parser.add_argument("--dynamo-only", action="store_true", help="Only upload to DynamoDB")
    args = parser.parse_args()

    s3_client, dynamo_resource = get_aws_clients()

    print(f"\n{'='*60}")
    print(f"  Carma AWS Upload")
    print(f"  Region: {AWS_REGION}")
    print(f"  S3 Bucket: {S3_BUCKET}")
    print(f"  DynamoDB Table: {DYNAMO_TABLE}")
    if args.slug:
        print(f"  Filter: {args.slug}")
    print(f"{'='*60}\n")

    start = time.time()
    total = 0

    if not args.dynamo_only:
        print("── S3 Upload ──────────────────────────────────────────")
        total += upload_to_s3(s3_client, args.slug)

    if not args.s3_only:
        print("\n── DynamoDB Upload ────────────────────────────────────")
        total += upload_to_dynamodb(dynamo_resource, args.slug)

    elapsed = time.time() - start
    print(f"\n{'='*60}")
    print(f"  ✅ Done — {total} items in {elapsed:.1f}s")
    print(f"{'='*60}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
