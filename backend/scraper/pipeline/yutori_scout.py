#!/usr/bin/env python3
"""
yutori_scout.py — Yutori Scouting API integration

Completely standalone — does NOT touch stages 1-6 or any pipeline files.
Call this after a search to set up ongoing monitoring for new listings.

Usage:
    from yutori_scout import create_car_scout, get_scout_updates, delete_scout

    # Create a scout after the pipeline runs
    scout_id = create_car_scout(
        query="toyota camry",
        location="Bay Area CA",
        max_price=15000,
        user_email="user@example.com"
    )

    # Later: check for new listings
    updates = get_scout_updates(scout_id)

    # When user is done
    delete_scout(scout_id)
"""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from yutori import YutoriClient

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