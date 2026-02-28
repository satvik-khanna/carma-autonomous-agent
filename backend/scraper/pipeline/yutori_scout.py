#!/usr/bin/env python3
"""
yutori_scout.py — Yutori Scouting API integration + AWS sync

Monitors Craigslist for new listings via Yutori Scouts.
When new listings are found, they're automatically pushed to DynamoDB.

Usage:
    from yutori_scout import create_car_scout, sync_scout_to_aws

    # Create a scout after the pipeline runs
    scout = create_car_scout(query="toyota camry", location="Bay Area CA", max_price=15000)

    # Sync latest scout findings → DynamoDB
    new_count = sync_scout_to_aws(scout["id"], slug="toyota_camry")
"""

from __future__ import annotations

import os
import re
import time
from decimal import Decimal
from typing import Any, Dict, List, Optional
from pathlib import Path

import boto3
from dotenv import load_dotenv
from yutori import YutoriClient

load_dotenv(Path(__file__).resolve().parent.parent.parent.parent / ".env.local")
load_dotenv()

client = YutoriClient(api_key=os.getenv("YUTORI_API_KEY"))

# How often the Scout re-runs (in seconds)
SCOUT_INTERVAL_SECONDS = 6 * 60 * 60  # every 6 hours


def build_scout_query(
    query: str,
    location: Optional[str] = None,
    max_price: Optional[int] = None,
    min_year: Optional[int] = None,
    max_mileage: Optional[int] = None,
) -> str:
    """
    Build a natural-language Scout query from search parameters.
    Yutori accepts plain English — no special syntax needed.
    """
    parts = [f'New Craigslist listings for "{query}"']

    if location:
        parts.append(f"in or near {location}")
    if max_price:
        parts.append(f"under ${max_price:,}")
    if min_year:
        parts.append(f"year {min_year} or newer")
    if max_mileage:
        parts.append(f"under {max_mileage:,} miles")

    base = " ".join(parts) + "."

    return (
        base + "\n\n"
        "Monitor Craigslist (cars+trucks section) and alert me whenever a new listing appears "
        "that matches these criteria. For each new listing found, return: title, price, mileage, "
        "year, URL, and location. Only include listings posted or updated in the last 24 hours. "
        "Skip listings without a price."
    )


def create_car_scout(
    query: str,
    location: Optional[str] = None,
    max_price: Optional[int] = None,
    min_year: Optional[int] = None,
    max_mileage: Optional[int] = None,
    webhook_url: Optional[str] = None,
    skip_email: bool = True,
) -> Dict[str, Any]:
    """
    Create a Yutori Scout that monitors Craigslist for new car listings.
    Returns the full scout object (contains scout['id'] for future calls).
    """
    scout_query = build_scout_query(query, location, max_price, min_year, max_mileage)

    kwargs: Dict[str, Any] = {
        "query": scout_query,
        "output_interval": SCOUT_INTERVAL_SECONDS,
        "skip_email": skip_email,
        # Ask for structured output so updates are easy to parse
        "output_schema": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title":    {"type": "string"},
                    "price":    {"type": "string"},
                    "mileage":  {"type": "string"},
                    "year":     {"type": "string"},
                    "url":      {"type": "string"},
                    "location": {"type": "string"},
                    "posted":   {"type": "string"},
                },
            },
        },
    }

    if webhook_url:
        kwargs["webhook_url"] = webhook_url

    scout = client.scouts.create(**kwargs)
    print(f"✅ Scout created: {scout['id']}")
    print(f"   Query: {query}")
    print(f"   Runs every: {SCOUT_INTERVAL_SECONDS // 3600}h")
    return scout


def get_scout_updates(scout_id: str, limit: int = 20) -> List[Dict[str, Any]]:
    """
    Fetch the latest updates from a Scout.
    Each update contains a list of new listings found since the last run.
    """
    updates = client.scouts.get_updates(scout_id, limit=limit)
    return updates.get("updates", []) if isinstance(updates, dict) else updates


def pause_scout(scout_id: str) -> None:
    client.scouts.update(scout_id, status="paused")
    print(f"⏸️  Scout {scout_id} paused")


def resume_scout(scout_id: str) -> None:
    client.scouts.update(scout_id, status="active")
    print(f"▶️  Scout {scout_id} resumed")


def delete_scout(scout_id: str) -> None:
    client.scouts.delete(scout_id)
    print(f"🗑️  Scout {scout_id} deleted")


def list_active_scouts() -> List[Dict[str, Any]]:
    result = client.scouts.list(status="active")
    return result.get("scouts", []) if isinstance(result, dict) else result


# ── AWS Sync ─────────────────────────────────────────────────────────────────

def _get_dynamo_table():
    session = boto3.Session(
        aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
        region_name=os.getenv("AWS_REGION", "us-east-2"),
    )
    dynamo = session.resource("dynamodb")
    return dynamo.Table(os.getenv("DYNAMODB_TABLE_NAME", "carma-listings"))


def _float_to_decimal(obj):
    if isinstance(obj, float):
        return Decimal(str(obj))
    if isinstance(obj, dict):
        return {k: _float_to_decimal(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_float_to_decimal(i) for i in obj]
    return obj


def _slugify(query: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", query.lower().strip()).strip("_")


def sync_scout_to_aws(
    scout_id: str,
    slug: str,
    limit: int = 50,
) -> int:
    """
    Fetch latest scout updates and push new listings to DynamoDB.
    Returns the number of new listings synced.
    """
    table = _get_dynamo_table()
    updates = get_scout_updates(scout_id, limit=limit)
    synced = 0

    for update in updates:
        listings = update if isinstance(update, list) else update.get("results", [])

        with table.batch_writer() as batch:
            for listing in listings:
                if not isinstance(listing, dict):
                    continue

                listing_url = listing.get("url", "")
                if not listing_url:
                    continue

                price_str = listing.get("price", "0")
                price_num = int(re.sub(r"[^\d]", "", price_str)) if price_str else None

                item = _float_to_decimal({
                    "pk": slug,
                    "sk": f"scout-{listing_url}",
                    "data_type": "scout",
                    "title": listing.get("title", ""),
                    "price_usd": price_num,
                    "mileage": listing.get("mileage"),
                    "year": listing.get("year"),
                    "url": listing_url,
                    "location": listing.get("location"),
                    "posted_at": listing.get("posted"),
                    "source": "yutori_scout",
                    "scout_id": scout_id,
                    "uploaded_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                })

                # Remove None values (DynamoDB doesn't accept them)
                item = {k: v for k, v in item.items() if v is not None}

                try:
                    batch.put_item(Item=item)
                    synced += 1
                except Exception as e:
                    print(f"  ✗ Failed to sync {listing_url}: {e}")

    print(f"  ✅ Synced {synced} scout listings to DynamoDB (slug: {slug})")
    return synced


def create_and_sync_scout(
    query: str,
    location: Optional[str] = None,
    max_price: Optional[int] = None,
    min_year: Optional[int] = None,
    max_mileage: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Create a scout and immediately sync any initial results to AWS.
    Returns the scout object.
    """
    scout = create_car_scout(query, location, max_price, min_year, max_mileage)
    slug = _slugify(query)
    sync_scout_to_aws(scout["id"], slug)
    return scout