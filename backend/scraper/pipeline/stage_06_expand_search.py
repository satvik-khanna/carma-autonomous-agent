#!/usr/bin/env python3
"""
Stage 6 — Expansion Agent

A truly agentic fallback that fires when Stage 5 results are insufficient.

Uses OpenAI function calling in a real tool loop — the model autonomously:
  1. Evaluates whether results are actually lacking (quality + quantity)
  2. Reasons about what alternative vehicles fit the user's intent
  3. Decides which alternatives to search for (via Tavily + Reddit research)
  4. Presents options interactively and waits for user confirmation
  5. Re-runs stages 1-4 for selected alternatives and merges everything back

Reads:  data/craigslist/05_research/research_{slug}.json  (Stage 5 output)
        OR data/craigslist/04_structured/listings_structured_{slug}.json (Stage 4 fallback)
Writes: data/craigslist/06_expanded/expanded_{slug}.json
        data/craigslist/04_structured/listings_structured_{slug}.json  (merged back in)

Usage (via run_pipeline.py):
    python run_pipeline.py "toyota camry" --stages 6
    python run_pipeline.py "reliable japanese commuter" --stages 1 2 3 4 5 6
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from openai import OpenAI
from tavily_client import client as tavily_client, stage_dir, query_slug

load_dotenv()
openai = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

CAR_QUERY = os.environ.get("CAR_QUERY")
if not CAR_QUERY:
    print("ERROR: CAR_QUERY env var not set. Use run_pipeline.py.", file=sys.stderr)
    sys.exit(1)

SLUG = query_slug(CAR_QUERY)
PIPELINE_DIR = Path(__file__).resolve().parent

# ── Paths ──
STAGE5_JSON = (PIPELINE_DIR / ".." / ".." / "data" / "craigslist" / "05_research" / f"research_{SLUG}.json").resolve()
STAGE4_JSON = stage_dir(4) / f"listings_structured_{SLUG}.json"
OUT_DIR = (PIPELINE_DIR / ".." / ".." / "data" / "craigslist" / "06_expanded").resolve()
OUT_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_JSON = OUT_DIR / f"expanded_{SLUG}.json"

MIN_GOOD_RESULTS = 20  # threshold that triggers expansion

# ─────────────────────────────────────────────────────────────────
# TOOLS the agent can call
# ─────────────────────────────────────────────────────────────────

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "evaluate_results",
            "description": (
                "Evaluate the current search results for quality and quantity. "
                "Returns metrics including good_quality count (listings with price + mileage + year), "
                "avg research score, and whether expansion is needed. Call this first."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "threshold": {
                        "type": "integer",
                        "description": "Minimum number of good-quality results needed. Default 20.",
                    }
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "research_alternatives",
            "description": (
                "Use Tavily + Reddit to research what alternative vehicles best fit the user's intent. "
                "Returns a ranked list of make/model suggestions with rationale. "
                "Call this when expansion is needed, before searching for listings."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "user_intent": {
                        "type": "string",
                        "description": "What the user is actually looking for, e.g. 'reliable japanese commuter under $15k'",
                    },
                    "already_searched": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Makes/models already in current results to avoid duplicates",
                    },
                },
                "required": ["user_intent", "already_searched"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "present_alternatives_to_user",
            "description": (
                "Show the discovered alternatives to the user and ask which ones they want to search. "
                "Blocks until user responds. Returns the user's selected alternatives. "
                "Call this after research_alternatives."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "alternatives": {
                        "type": "array",
                        "description": "List of alternatives to show the user",
                        "items": {
                            "type": "object",
                            "properties": {
                                "make_model": {"type": "string"},
                                "rationale": {"type": "string"},
                                "priority": {"type": "integer"},
                            },
                        },
                    },
                    "reason": {
                        "type": "string",
                        "description": "Short explanation of why we're expanding (shown to user)",
                    },
                },
                "required": ["alternatives", "reason"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_pipeline_for_query",
            "description": (
                "Run stages 1-4 of the scraping pipeline for a specific car query. "
                "This searches Craigslist, extracts listings, and structures them. "
                "Call this for each alternative the user selected. "
                "Returns how many new listings were found."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Car make/model to search for, e.g. 'toyota corolla'",
                    },
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "merge_and_finalize",
            "description": (
                "Merge all discovered listings (original + alternatives) into one ranked output. "
                "Call this after all pipeline runs are complete."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "searched_queries": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "All car queries that were searched (original + alternatives)",
                    },
                },
                "required": ["searched_queries"],
            },
        },
    },
]


# ─────────────────────────────────────────────────────────────────
# TOOL IMPLEMENTATIONS
# ─────────────────────────────────────────────────────────────────

def _load_current_listings() -> List[Dict[str, Any]]:
    """Load listings from stage 5 output (preferred) or stage 4 fallback."""
    if STAGE5_JSON.exists():
        with STAGE5_JSON.open("r", encoding="utf-8") as f:
            data = json.load(f)
        return data.get("listings", []) if isinstance(data, dict) else data
    if STAGE4_JSON.exists():
        with STAGE4_JSON.open("r", encoding="utf-8") as f:
            return json.load(f)
    return []


def tool_evaluate_results(threshold: int = MIN_GOOD_RESULTS) -> Dict[str, Any]:
    listings = _load_current_listings()

    good = [
        r for r in listings
        if r.get("price_usd") and r.get("mileage") and r.get("year")
    ]

    research_scores = [
        r.get("research", {}).get("research_score", None)
        for r in listings
        if r.get("research")
    ]
    avg_score = round(sum(research_scores) / len(research_scores), 1) if research_scores else None

    makes_models = list({
        f"{r.get('make', '')} {r.get('model', '')}".strip()
        for r in listings
        if r.get("make")
    })

    result = {
        "total_listings": len(listings),
        "good_quality": len(good),
        "with_price": sum(1 for r in listings if r.get("price_usd")),
        "with_mileage": sum(1 for r in listings if r.get("mileage")),
        "with_research": len(research_scores),
        "avg_research_score": avg_score,
        "makes_models_found": makes_models,
        "needs_expansion": len(good) < threshold,
        "threshold": threshold,
    }

    print(f"\n  📊 Evaluation:")
    print(f"     Total listings:    {result['total_listings']}")
    print(f"     Good quality:      {result['good_quality']} (need {threshold})")
    print(f"     Avg Reddit score:  {avg_score}/10" if avg_score else "     Avg Reddit score:  n/a")
    print(f"     Expansion needed:  {'YES ↓' if result['needs_expansion'] else 'NO — results sufficient'}")

    return result


def tool_research_alternatives(user_intent: str, already_searched: List[str]) -> Dict[str, Any]:
    print(f"\n  🧠 Researching alternatives for: \"{user_intent}\"")
    print(f"     Already searched: {already_searched}")
    print(f"     Querying Tavily + Reddit...")

    # Tavily search for best alternatives
    query = f"best used cars for {user_intent} reliable affordable alternatives site:reddit.com OR site:edmunds.com"
    try:
        response = tavily_client.search(
            query=query,
            search_depth="advanced",
            max_results=5,
            include_domains=["reddit.com", "edmunds.com", "consumerreports.org"],
            include_answer=True,
        )
        research_text = (response.get("answer") or "") + "\n\n"
        for r in response.get("results", []):
            research_text += f"[{r.get('title', '')}]: {r.get('content', '')[:500]}\n\n"
    except Exception as e:
        research_text = f"Tavily search failed: {e}"

    # Ask GPT-4o to parse and structure recommendations
    completion = openai.chat.completions.create(
        model="gpt-4o",
        temperature=0.2,
        response_format={"type": "json_object"},
        messages=[
            {
                "role": "system",
                "content": (
                    f'You are a car research assistant. Given research about "{user_intent}", '
                    f'return a JSON list of 3-5 alternative vehicle recommendations that are NOT '
                    f'already in the searched list: {already_searched}.\n'
                    'Return ONLY: { "recommendations": [{ "make_model": "Toyota Corolla", '
                    '"rationale": "High reliability, low maintenance, excellent fuel economy", '
                    '"priority": 1 }] }'
                ),
            },
            {
                "role": "user",
                "content": (
                    f'User intent: "{user_intent}"\n'
                    f'Already searched: {", ".join(already_searched)}\n\n'
                    f'Research:\n{research_text}'
                ),
            },
        ],
    )

    result = json.loads(completion.choices[0].message.content)
    recommendations = result.get("recommendations", [])

    print(f"     Found {len(recommendations)} alternatives:")
    for r in recommendations:
        print(f"       {r['priority']}. {r['make_model']} — {r['rationale'][:60]}...")

    return result


def tool_present_alternatives_to_user(
    alternatives: List[Dict[str, Any]], reason: str
) -> Dict[str, Any]:
    """Print alternatives to terminal and collect user input."""
    print(f"\n{'='*60}")
    print(f"  🤖 Expansion Agent")
    print(f"{'='*60}")
    print(f"\n  {reason}\n")
    print(f"  Would you like to also search for these vehicles?\n")

    for i, alt in enumerate(alternatives, 1):
        print(f"  [{i}] {alt['make_model']}")
        print(f"      {alt['rationale']}")
        print()

    print(f"  Enter numbers to include (e.g. '1 3') or 'all' or 'none':")
    print(f"  > ", end="", flush=True)

    try:
        raw = input().strip().lower()
    except (EOFError, KeyboardInterrupt):
        raw = "none"

    if raw == "all":
        selected_indices = list(range(len(alternatives)))
    elif raw == "none" or not raw:
        selected_indices = []
    else:
        nums = re.findall(r"\d+", raw)
        selected_indices = [int(n) - 1 for n in nums if 0 < int(n) <= len(alternatives)]

    selected = [alternatives[i] for i in selected_indices]

    if selected:
        print(f"\n  ✅ Selected: {', '.join(s['make_model'] for s in selected)}")
    else:
        print(f"\n  ℹ️  No alternatives selected.")

    return {
        "selected": selected,
        "count": len(selected),
    }


def tool_run_pipeline_for_query(query: str) -> Dict[str, Any]:
    """Re-run stages 1-4 for an alternative car query."""
    print(f"\n  🔄 Running pipeline for: \"{query}\"")
    print(f"     Stages: 1 → 2 → 3 → 4 (skipping 5 for speed)")

    env = os.environ.copy()
    env["CAR_QUERY"] = query

    start = time.time()
    result = subprocess.run(
        [sys.executable, str(PIPELINE_DIR / "run_pipeline.py"), query, "--stages", "1", "2", "3", "4"],
        cwd=str(PIPELINE_DIR),
        env=env,
        capture_output=False,
    )

    elapsed = time.time() - start

    if result.returncode != 0:
        print(f"     ❌ Pipeline failed for \"{query}\" (exit {result.returncode})")
        return {"query": query, "success": False, "new_listings": 0, "elapsed": elapsed}

    # Count listings from the new stage 4 output
    new_slug = query_slug(query)
    new_json = stage_dir(4) / f"listings_structured_{new_slug}.json"
    count = 0
    if new_json.exists():
        with new_json.open("r", encoding="utf-8") as f:
            data = json.load(f)
        count = len(data) if isinstance(data, list) else 0

    print(f"     ✅ Found {count} listings for \"{query}\" in {elapsed:.0f}s")
    return {"query": query, "success": True, "new_listings": count, "elapsed": elapsed}


def tool_merge_and_finalize(searched_queries: List[str]) -> Dict[str, Any]:
    """Merge listings from all queries into one unified output."""
    print(f"\n  🔀 Merging results from {len(searched_queries)} queries...")

    all_listings: List[Dict[str, Any]] = []
    seen_ids: set = set()
    counts: Dict[str, int] = {}

    for query in searched_queries:
        slug = query_slug(query)

        # Try to get stage 5 enriched data first, fall back to stage 4
        stage5 = (PIPELINE_DIR / ".." / ".." / "data" / "craigslist" / "05_research" / f"research_{slug}.json").resolve()
        stage4 = stage_dir(4) / f"listings_structured_{slug}.json"

        listings = []
        if stage5.exists():
            with stage5.open("r", encoding="utf-8") as f:
                data = json.load(f)
            listings = data.get("listings", []) if isinstance(data, dict) else data
        elif stage4.exists():
            with stage4.open("r", encoding="utf-8") as f:
                listings = json.load(f)

        added = 0
        for listing in listings:
            lid = listing.get("id") or listing.get("url")
            if lid and lid not in seen_ids:
                seen_ids.add(lid)
                listing["_source_query"] = query
                all_listings.append(listing)
                added += 1

        counts[query] = added
        print(f"     + {added} listings from \"{query}\"")

    # Sort by research score desc, then price asc
    def sort_key(r):
        score = r.get("research", {}).get("research_score", 0)
        price = r.get("price_usd") or 999999
        return (-score, price)

    all_listings.sort(key=sort_key)

    # Write merged output
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "original_query": CAR_QUERY,
        "searched_queries": searched_queries,
        "listings_per_query": counts,
        "total_listings": len(all_listings),
        "listings": all_listings,
    }

    with OUTPUT_JSON.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    # Also overwrite the original stage 4 structured file so downstream stages
    # (and the frontend) pick up the expanded results transparently
    merged_stage4 = stage_dir(4) / f"listings_structured_{SLUG}.json"
    with merged_stage4.open("w", encoding="utf-8") as f:
        json.dump(all_listings, f, ensure_ascii=False, indent=2)

    print(f"\n  📦 Total merged: {len(all_listings)} listings")
    print(f"     Output: {OUTPUT_JSON}")

    return {
        "total_listings": len(all_listings),
        "listings_per_query": counts,
        "output_path": str(OUTPUT_JSON),
    }


# ─────────────────────────────────────────────────────────────────
# TOOL DISPATCHER
# ─────────────────────────────────────────────────────────────────

def dispatch(tool_name: str, args: Dict[str, Any]) -> Any:
    if tool_name == "evaluate_results":
        return tool_evaluate_results(args.get("threshold", MIN_GOOD_RESULTS))
    elif tool_name == "research_alternatives":
        return tool_research_alternatives(args["user_intent"], args.get("already_searched", []))
    elif tool_name == "present_alternatives_to_user":
        return tool_present_alternatives_to_user(args["alternatives"], args["reason"])
    elif tool_name == "run_pipeline_for_query":
        return tool_run_pipeline_for_query(args["query"])
    elif tool_name == "merge_and_finalize":
        return tool_merge_and_finalize(args["searched_queries"])
    else:
        return {"error": f"Unknown tool: {tool_name}"}


# ─────────────────────────────────────────────────────────────────
# AGENT LOOP
# ─────────────────────────────────────────────────────────────────

def run_agent() -> int:
    print(f"\n  🤖 Expansion Agent starting for \"{CAR_QUERY}\"")

    messages = [
        {
            "role": "system",
            "content": (
                "You are an autonomous car search expansion agent running as part of a pipeline.\n\n"
                "Your job:\n"
                "1. Call evaluate_results to check if current listings are sufficient (default threshold: 20 good results)\n"
                "2. If insufficient, call research_alternatives to find vehicles matching the user's intent\n"
                "3. Call present_alternatives_to_user to let the user choose which ones to search\n"
                "4. For each selected alternative, call run_pipeline_for_query\n"
                "5. Call merge_and_finalize with ALL queries (original + selected alternatives)\n\n"
                "If results ARE sufficient (needs_expansion=false), call merge_and_finalize with just the original query and stop.\n"
                "Do NOT search for more than 4 alternatives. Be decisive."
            ),
        },
        {
            "role": "user",
            "content": (
                f'Original search query: "{CAR_QUERY}"\n'
                f'Please evaluate the results and expand the search if needed.'
            ),
        },
    ]

    MAX_ITERATIONS = 15
    iteration = 0
    done = False

    while not done and iteration < MAX_ITERATIONS:
        iteration += 1

        response = openai.chat.completions.create(
            model="gpt-4o",
            tools=TOOLS,
            tool_choice="auto",
            messages=messages,
        )

        msg = response.choices[0].message
        messages.append(msg.model_dump())

        # No tool calls = agent thinks it's done
        if not msg.tool_calls:
            if msg.content:
                print(f"\n  Agent: {msg.content}")
            done = True
            break

        # Execute each tool call
        for tc in msg.tool_calls:
            name = tc.function.name
            args = json.loads(tc.function.arguments)

            print(f"\n  → [{name}]", end="", flush=True)

            result = dispatch(name, args)

            # Signal loop exit after finalize
            if name == "merge_and_finalize":
                done = True

            messages.append({
                "role": "tool",
                "tool_call_id": tc.id,
                "content": json.dumps(result),
            })

    if iteration >= MAX_ITERATIONS:
        print(f"\n  ⚠️  Agent hit iteration limit ({MAX_ITERATIONS}). Stopping.")

    return 0


# ─────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────

def main() -> int:
    if not STAGE5_JSON.exists() and not STAGE4_JSON.exists():
        print(
            f"ERROR: No Stage 4 or Stage 5 output found for \"{CAR_QUERY}\".\n"
            f"Run stages 1-4 (and optionally 5) first.",
            file=sys.stderr,
        )
        return 1

    if not os.getenv("OPENAI_API_KEY"):
        print("ERROR: OPENAI_API_KEY not set in .env", file=sys.stderr)
        return 1

    return run_agent()


if __name__ == "__main__":
    raise SystemExit(main())