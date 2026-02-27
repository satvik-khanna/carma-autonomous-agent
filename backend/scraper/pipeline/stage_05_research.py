#!/usr/bin/env python3
"""
Stage 5 — Reddit Research Agent

For each car listing from Stage 4, use Tavily Search to research
real owner experiences, advice, and opinions from Reddit:

  1. r/whatcarshouldIbuy — "Should I buy a {car}?"
  2. r/cars, r/askcarsales — Common problems & reliability
  3. r/MechanicAdvice — What mechanics say about the car
  4. r/personalfinance — Is this a good financial decision?
  5. Model-specific subreddits — Deep owner experiences

All searches are restricted to reddit.com for authentic, unfiltered opinions.

Reads:  data/craigslist/04_structured/listings_structured_{slug}.json
Writes: data/craigslist/05_research/research_{slug}.json
        data/craigslist/04_structured/listings_enriched_{slug}.json
"""

from __future__ import annotations

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
INPUT_JSON = stage_dir(4) / f"listings_structured_{SLUG}.json"

STAGE_DIRS_EXTRA = {5: (Path(__file__).resolve().parent / ".." / ".." / "data" / "craigslist" / "05_research").resolve()}
OUT_DIR = STAGE_DIRS_EXTRA[5]
OUT_DIR.mkdir(parents=True, exist_ok=True)

OUTPUT_JSON = OUT_DIR / f"research_{SLUG}.json"

# ── Settings ──
MAX_CARS_TO_RESEARCH = 15
DELAY_BETWEEN_SEARCHES = 0.5
MAX_RESULTS_PER_SEARCH = 5

# ── Model-specific subreddit mapping ──
BRAND_SUBREDDITS = {
    "toyota": "r/Toyota OR r/Camry OR r/Corolla OR r/RAV4 OR r/4Runner",
    "honda": "r/Honda OR r/civic OR r/accord",
    "lexus": "r/Lexus",
    "nissan": "r/Nissan",
    "mazda": "r/mazda",
    "subaru": "r/subaru OR r/WRX",
    "hyundai": "r/Hyundai",
    "kia": "r/kia",
    "ford": "r/Ford OR r/Mustang OR r/f150",
    "chevrolet": "r/Chevrolet OR r/Camaro OR r/Corvette",
    "bmw": "r/BMW",
    "mercedes": "r/mercedes_benz",
    "audi": "r/Audi",
    "volkswagen": "r/Volkswagen OR r/GolfGTI",
    "jeep": "r/Jeep OR r/WranglerJL",
    "dodge": "r/Dodge OR r/Challenger",
    "tesla": "r/TeslaMotors OR r/TeslaModel3",
    "porsche": "r/Porsche",
    "acura": "r/Acura",
    "infiniti": "r/infiniti",
    "volvo": "r/Volvo",
}


# ═══════════════════════════════════════════════════════════════════
#  Reddit-focused research queries
# ═══════════════════════════════════════════════════════════════════

def build_reddit_queries(car: Dict[str, Any]) -> List[Dict[str, str]]:
    """Build Reddit-specific search queries for a car."""
    year = car.get("year", "")
    make = (car.get("make") or "").strip()
    model = (car.get("model") or "").strip()
    mileage = car.get("mileage", "")
    price = car.get("price_usd")

    # Avoid duplicate year (e.g. year=2014, make="2014 Toyota" → "2014 2014 Toyota")
    if make and str(year) in make:
        car_name = f"{make} {model}".strip()
    else:
        car_name = f"{year} {make} {model}".strip()
    if not car_name or car_name.strip() == "":
        car_name = car.get("title", "unknown car")

    # Get brand-specific subreddit hints — extract actual brand from make
    actual_brand = make.lower().replace(str(year), "").strip() if year else make.lower()
    brand_subs = BRAND_SUBREDDITS.get(actual_brand, "")

    queries = []

    # 1. "Should I buy this car?" — r/whatcarshouldIbuy
    price_ctx = f"for ${price:,}" if price else ""
    mileage_ctx = f"with {mileage:,} miles" if mileage else ""
    queries.append({
        "category": "should_i_buy",
        "query": f'site:reddit.com r/whatcarshouldIbuy "{make} {model}" {year} {price_ctx} {mileage_ctx} should I buy worth it'.strip(),
        "purpose": "Find real advice from Reddit on whether this car is worth buying",
    })

    # 2. Common problems & what to watch for — r/MechanicAdvice
    queries.append({
        "category": "mechanic_advice",
        "query": f'site:reddit.com r/MechanicAdvice OR r/cars "{make} {model}" {year} problems issues reliability things to watch'.strip(),
        "purpose": "Learn what mechanics and car enthusiasts say about common problems",
    })

    # 3. Long-term ownership experience — brand subreddits
    queries.append({
        "category": "ownership_experience",
        "query": f'site:reddit.com {brand_subs} "{make} {model}" ownership review experience years'.strip(),
        "purpose": "Find long-term owner reviews from dedicated brand communities",
    })

    # 4. Maintenance costs & what to expect — r/askcarsales + r/personalfinance
    queries.append({
        "category": "costs_and_value",
        "query": f'site:reddit.com r/askcarsales OR r/personalfinance "{make} {model}" {year} maintenance cost insurance depreciation'.strip(),
        "purpose": "Understand ongoing costs, depreciation, and financial implications",
    })

    # 5. High mileage concerns (if applicable)
    if mileage and int(mileage) > 80000:
        queries.append({
            "category": "high_mileage",
            "query": f'site:reddit.com "{make} {model}" high mileage {mileage} miles still reliable worth buying'.strip(),
            "purpose": "Check if high mileage is a concern for this specific model",
        })

    return queries


# ═══════════════════════════════════════════════════════════════════
#  Tavily search — Reddit only
# ═══════════════════════════════════════════════════════════════════

def search_reddit(query: str) -> Dict[str, Any]:
    """Execute a Tavily search restricted to Reddit."""
    try:
        response = client.search(
            query=query,
            search_depth="advanced",
            max_results=MAX_RESULTS_PER_SEARCH,
            include_domains=["reddit.com"],
            include_answer=True,
        )
        return {
            "answer": response.get("answer") or "",
            "results": [
                {
                    "title": r.get("title", ""),
                    "url": r.get("url", ""),
                    "content": (r.get("content") or "")[:800],
                    "score": r.get("score", 0),
                    "subreddit": extract_subreddit(r.get("url", "")),
                }
                for r in (response.get("results") or [])
            ],
            "error": None,
        }
    except Exception as e:
        return {"answer": "", "results": [], "error": str(e)}


def extract_subreddit(url: str) -> str:
    """Extract subreddit name from a Reddit URL."""
    match = re.search(r"reddit\.com/r/(\w+)", url)
    return f"r/{match.group(1)}" if match else "reddit"


# ═══════════════════════════════════════════════════════════════════
#  Analysis — extract insights from Reddit discussions
# ═══════════════════════════════════════════════════════════════════

def get_all_text(search_result: Dict) -> str:
    """Combine all text from a search result."""
    text = (search_result.get("answer") or "") + " "
    text += " ".join((r.get("content") or "") for r in search_result.get("results", []))
    return text


def analyze_should_i_buy(search_result: Dict) -> Dict[str, Any]:
    """Analyze Reddit 'should I buy' advice."""
    text = get_all_text(search_result).lower()

    buy_signals = [
        "go for it", "great car", "highly recommend", "can't go wrong",
        "buy it", "worth it", "solid choice", "reliable", "good buy",
        "pull the trigger", "you won't regret", "excellent choice",
        "best in class", "bullet proof", "bulletproof", "great deal",
        "steal at that price", "no brainer",
    ]
    avoid_signals = [
        "avoid", "stay away", "don't buy", "walk away",
        "money pit", "not worth", "overpriced", "pass on",
        "better options", "look elsewhere", "lemon", "nightmare",
        "run away", "save yourself", "waste of money", "regret",
    ]

    buy_count = sum(1 for s in buy_signals if s in text)
    avoid_count = sum(1 for s in avoid_signals if s in text)

    if buy_count > avoid_count + 2:
        verdict = "strong_buy"
        score = 9
    elif buy_count > avoid_count:
        verdict = "buy"
        score = 7
    elif avoid_count > buy_count + 2:
        verdict = "avoid"
        score = 2
    elif avoid_count > buy_count:
        verdict = "caution"
        score = 4
    else:
        verdict = "neutral"
        score = 5

    # Extract specific Reddit advice snippets
    advice_snippets = []
    for r in search_result.get("results", []):
        content = r.get("content", "")
        if content and len(content) > 50:
            # Find sentences with useful advice
            sentences = re.split(r'[.!?]', content)
            for s in sentences:
                s = s.strip()
                if len(s) > 30 and any(kw in s.lower() for kw in ["should", "would", "recommend", "avoid", "buy", "check", "make sure", "watch", "look"]):
                    advice_snippets.append(s[:200])
                    if len(advice_snippets) >= 3:
                        break

    return {
        "reddit_verdict": verdict,
        "confidence_score": score,
        "buy_signals": buy_count,
        "avoid_signals": avoid_count,
        "advice": advice_snippets[:3],
        "summary": (search_result.get("answer") or "")[:400],
        "sources": [{"subreddit": r.get("subreddit", ""), "url": r.get("url", "")} for r in search_result.get("results", [])[:3]],
    }


def analyze_mechanic_advice(search_result: Dict) -> Dict[str, Any]:
    """Analyze mechanic and car enthusiast opinions."""
    text = get_all_text(search_result).lower()

    # Mechanical issues
    problem_patterns = [
        (r"(transmission\s+(?:failure|problems?|issues?|slipping))", "transmission"),
        (r"(engine\s+(?:failure|problems?|issues?|knock|tick))", "engine"),
        (r"(head\s+gasket\s+(?:failure|blow|leak))", "head gasket"),
        (r"(oil\s+(?:consumption|leak|burning))", "oil consumption"),
        (r"(rust|corrosion)", "rust/corrosion"),
        (r"(timing\s+(?:chain|belt)\s+(?:failure|stretch|issues?))", "timing chain/belt"),
        (r"(brake\s+(?:problems?|issues?|warping))", "brakes"),
        (r"(electrical\s+(?:problems?|issues?|gremlins))", "electrical"),
        (r"(suspension\s+(?:problems?|issues?|noise|bushing))", "suspension"),
        (r"(ac|air\s+conditioning)\s+(?:failure|problems?|issues?)", "A/C"),
        (r"(turbo\s+(?:failure|problems?|issues?))", "turbo"),
        (r"(cvt\s+(?:failure|problems?|issues?|shudder))", "CVT"),
        (r"(catalytic\s+converter)", "catalytic converter"),
        (r"(water\s+pump\s+(?:failure|leak))", "water pump"),
        (r"(alternator\s+(?:failure|problems?))", "alternator"),
    ]

    found_issues = []
    for pattern, label in problem_patterns:
        if re.search(pattern, text, re.IGNORECASE):
            found_issues.append(label)

    # Things to check before buying
    pre_purchase = []
    check_phrases = [
        "check the", "look at the", "make sure", "get a PPI",
        "pre-purchase inspection", "have a mechanic look",
        "scan for codes", "test drive", "look for",
    ]
    for r in search_result.get("results", []):
        content = r.get("content", "")
        sentences = re.split(r'[.!?]', content)
        for s in sentences:
            s = s.strip()
            if any(phrase in s.lower() for phrase in check_phrases) and len(s) > 20:
                pre_purchase.append(s[:150])

    # Reliability keywords
    reliable_words = ["reliable", "dependable", "bulletproof", "solid", "tank", "forever car", "300k miles"]
    unreliable_words = ["unreliable", "money pit", "shop queen", "constant repairs", "known for problems"]

    reliable_score = sum(1 for w in reliable_words if w in text)
    unreliable_score = sum(1 for w in unreliable_words if w in text)

    if reliable_score > unreliable_score + 1:
        reliability = "reliable"
        reliability_score = 8
    elif unreliable_score > reliable_score + 1:
        reliability = "unreliable"
        reliability_score = 3
    elif reliable_score > unreliable_score:
        reliability = "mostly_reliable"
        reliability_score = 7
    elif unreliable_score > reliable_score:
        reliability = "questionable"
        reliability_score = 4
    else:
        reliability = "average"
        reliability_score = 6

    return {
        "reliability_rating": reliability,
        "reliability_score": reliability_score,
        "known_issues": list(set(found_issues))[:6],
        "pre_purchase_checks": list(set(pre_purchase))[:4],
        "summary": (search_result.get("answer") or "")[:400],
    }


def analyze_ownership(search_result: Dict) -> Dict[str, Any]:
    """Analyze long-term ownership experiences from brand subreddits."""
    text = get_all_text(search_result).lower()

    # Pros and cons extraction
    pros = []
    cons = []

    pro_patterns = [
        "love", "great", "excellent", "amazing", "best", "smooth",
        "comfortable", "fuel efficient", "fun to drive", "well built",
        "no problems", "no issues", "reliable", "low maintenance",
    ]
    con_patterns = [
        "hate", "annoying", "uncomfortable", "loud", "poor",
        "cheap interior", "rust", "expensive to maintain", "boring",
        "underpowered", "slow", "bad mpg", "cramped", "noisy",
    ]

    for p in pro_patterns:
        if p in text:
            pros.append(p)
    for c in con_patterns:
        if c in text:
            cons.append(c)

    # Overall satisfaction
    satisfaction_pos = sum(text.count(w) for w in ["love", "happy", "satisfied", "glad", "great", "recommend"])
    satisfaction_neg = sum(text.count(w) for w in ["regret", "disappointed", "unhappy", "wish", "should have", "mistake"])

    if satisfaction_pos > satisfaction_neg * 2:
        satisfaction = "very_satisfied"
        score = 9
    elif satisfaction_pos > satisfaction_neg:
        satisfaction = "satisfied"
        score = 7
    elif satisfaction_neg > satisfaction_pos:
        satisfaction = "dissatisfied"
        score = 3
    else:
        satisfaction = "neutral"
        score = 5

    return {
        "owner_satisfaction": satisfaction,
        "satisfaction_score": score,
        "pros": list(set(pros))[:5],
        "cons": list(set(cons))[:5],
        "summary": (search_result.get("answer") or "")[:400],
    }


def analyze_costs(search_result: Dict, asking_price: Optional[int]) -> Dict[str, Any]:
    """Analyze cost discussions from r/askcarsales and r/personalfinance."""
    text = get_all_text(search_result)

    # Extract price mentions
    price_matches = re.findall(r"\$([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,6})", text)
    prices = []
    for p in price_matches:
        try:
            val = int(p.replace(",", ""))
            if 1000 <= val <= 500000:
                prices.append(val)
        except ValueError:
            pass

    # Depreciation mentions
    depreciation_bad = ["depreciates fast", "loses value", "depreciation hit", "drops like a rock"]
    depreciation_good = ["holds value", "resale", "good resale", "retains value"]
    holds_value = any(d in text.lower() for d in depreciation_good)
    depreciates_fast = any(d in text.lower() for d in depreciation_bad)

    # Insurance mentions
    insurance_expensive = any(k in text.lower() for k in ["expensive to insure", "high insurance", "insurance is crazy"])
    insurance_cheap = any(k in text.lower() for k in ["cheap to insure", "low insurance", "affordable insurance"])

    # Market price estimate
    market_estimate = None
    price_verdict = "unknown"
    if prices:
        market_estimate = int(sum(prices) / len(prices))
        if asking_price:
            ratio = asking_price / market_estimate
            if ratio < 0.85:
                price_verdict = "below_market"
            elif ratio < 1.0:
                price_verdict = "fair"
            elif ratio < 1.15:
                price_verdict = "slightly_above"
            else:
                price_verdict = "overpriced"

    return {
        "estimated_market_value": market_estimate,
        "price_verdict": price_verdict,
        "holds_value": holds_value,
        "depreciates_fast": depreciates_fast,
        "insurance_note": "expensive" if insurance_expensive else "affordable" if insurance_cheap else "average",
        "summary": (search_result.get("answer") or "")[:400],
    }


def analyze_high_mileage(search_result: Dict, mileage: int) -> Dict[str, Any]:
    """Analyze high-mileage specific concerns from Reddit."""
    text = get_all_text(search_result).lower()

    still_good = ["still going strong", "runs great", "no problems at", "plenty of life",
                   "these go forever", "300k", "250k", "200k"]
    warning = ["at that mileage", "probably needs", "timing belt", "worn out",
               "expect to replace", "major service", "overhaul"]

    good_count = sum(1 for s in still_good if s in text)
    warn_count = sum(1 for s in warning if s in text)

    if good_count > warn_count:
        verdict = "still_viable"
        score = 7
    elif warn_count > good_count:
        verdict = "proceed_with_caution"
        score = 4
    else:
        verdict = "get_inspected"
        score = 5

    return {
        "high_mileage_verdict": verdict,
        "confidence_score": score,
        "mileage": mileage,
        "summary": (search_result.get("answer") or "")[:400],
    }


# ═══════════════════════════════════════════════════════════════════
#  Build final verdict from Reddit research
# ═══════════════════════════════════════════════════════════════════

def build_verdict(car: Dict, research: Dict) -> str:
    """Generate a human-readable verdict from Reddit research."""
    parts = []
    year = car.get("year", "")
    make = car.get("make", "")
    model = car.get("model", "")
    car_name = f"{year} {make} {model}".strip()

    # Should I buy verdict
    sib = research.get("should_i_buy", {})
    v = sib.get("reddit_verdict", "neutral")
    if v in ("strong_buy", "buy"):
        parts.append(f"Reddit says: BUY the {car_name}")
    elif v in ("avoid", "caution"):
        parts.append(f"Reddit says: CAUTION on the {car_name}")
    else:
        parts.append(f"Reddit is mixed on the {car_name}")

    # Reliability
    mech = research.get("mechanic_advice", {})
    issues = mech.get("known_issues", [])
    rel = mech.get("reliability_rating", "average")
    if rel in ("reliable", "mostly_reliable"):
        parts.append("Considered reliable by mechanics")
    elif rel in ("unreliable", "questionable"):
        parts.append("Has reliability concerns")
    if issues:
        parts.append(f"Watch for: {', '.join(issues[:3])}")

    # Owner satisfaction
    own = research.get("ownership_experience", {})
    sat = own.get("owner_satisfaction", "neutral")
    if sat in ("very_satisfied", "satisfied"):
        parts.append("Owners are generally happy")
    elif sat == "dissatisfied":
        parts.append("Some owners report dissatisfaction")

    # Price
    costs = research.get("costs_and_value", {})
    pv = costs.get("price_verdict", "unknown")
    est = costs.get("estimated_market_value")
    if pv == "below_market" and est:
        parts.append(f"💰 Priced below market (~${est:,})")
    elif pv == "overpriced" and est:
        parts.append(f"⚠️ May be overpriced vs market (~${est:,})")
    elif pv == "fair":
        parts.append("Price looks fair for the market")

    # High mileage warning
    hm = research.get("high_mileage", {})
    if hm:
        hmv = hm.get("high_mileage_verdict", "")
        if hmv == "proceed_with_caution":
            parts.append("⚠️ High mileage — get a thorough inspection")

    return ". ".join(parts) + "." if parts else "Limited Reddit data available."


# ═══════════════════════════════════════════════════════════════════
#  Main pipeline
# ═══════════════════════════════════════════════════════════════════

def main() -> int:
    if not INPUT_JSON.exists():
        raise SystemExit(f"Missing input: {INPUT_JSON}\nRun Stage 4 first.")

    with INPUT_JSON.open("r", encoding="utf-8") as f:
        listings = json.load(f)

    if not isinstance(listings, list):
        raise SystemExit(f"Expected a JSON array in {INPUT_JSON}")

    # Sort by price (research the most valuable first) and limit
    priced = [l for l in listings if l.get("price_usd")]
    priced.sort(key=lambda x: x["price_usd"], reverse=True)
    unpriced = [l for l in listings if not l.get("price_usd")]
    to_research = (priced + unpriced)[:MAX_CARS_TO_RESEARCH]

    total = len(to_research)
    print(f"🔬 Reddit Research Agent — researching {total} listings for \"{CAR_QUERY}\"")
    print(f"   ({len(listings)} total listings, researching top {total})")
    print(f"   Source: reddit.com only (real owner opinions)\n")

    all_research = []
    total_searches = 0

    for idx, car in enumerate(to_research, 1):
        car_name = f"{car.get('year', '?')} {car.get('make', '?')} {car.get('model', '?')}".strip()
        price_str = f"${car.get('price_usd', 0):,}" if car.get("price_usd") else "no price"
        mileage_str = f"{car.get('mileage', 0):,} mi" if car.get("mileage") else "? mi"
        print(f"  🚗 [{idx}/{total}] {car_name} — {price_str} — {mileage_str}")

        queries = build_reddit_queries(car)
        research_data = {"car_id": car.get("id", ""), "car_title": car.get("title", "")}

        for q in queries:
            cat = q["category"]
            print(f"     � {cat}: searching Reddit...")

            result = search_reddit(q["query"])
            total_searches += 1
            num_results = len(result.get("results", []))
            subreddits = set(r.get("subreddit", "") for r in result.get("results", []) if r.get("subreddit"))
            print(f"        → {num_results} results from {', '.join(subreddits) if subreddits else 'reddit'}")

            # Analyze based on category
            if cat == "should_i_buy":
                research_data["should_i_buy"] = analyze_should_i_buy(result)
            elif cat == "mechanic_advice":
                research_data["mechanic_advice"] = analyze_mechanic_advice(result)
            elif cat == "ownership_experience":
                research_data["ownership_experience"] = analyze_ownership(result)
            elif cat == "costs_and_value":
                research_data["costs_and_value"] = analyze_costs(result, car.get("price_usd"))
            elif cat == "high_mileage":
                research_data["high_mileage"] = analyze_high_mileage(result, car.get("mileage", 0))

            time.sleep(DELAY_BETWEEN_SEARCHES)

        # Build verdict
        research_data["verdict"] = build_verdict(car, research_data)
        research_data["researched_at"] = datetime.now(timezone.utc).isoformat()
        research_data["source"] = "reddit"

        # Compute composite research score
        scores = []
        if "should_i_buy" in research_data:
            scores.append(research_data["should_i_buy"].get("confidence_score", 5))
        if "mechanic_advice" in research_data:
            scores.append(research_data["mechanic_advice"].get("reliability_score", 5))
        if "ownership_experience" in research_data:
            scores.append(research_data["ownership_experience"].get("satisfaction_score", 5))
        if "costs_and_value" in research_data:
            pv = research_data["costs_and_value"].get("price_verdict", "unknown")
            scores.append({"below_market": 9, "fair": 7, "slightly_above": 4, "overpriced": 2}.get(pv, 5))
        if "high_mileage" in research_data:
            scores.append(research_data["high_mileage"].get("confidence_score", 5))

        research_data["research_score"] = round(sum(scores) / max(len(scores), 1), 1)

        all_research.append(research_data)

        # Print result
        score = research_data["research_score"]
        bar = "█" * int(score) + "░" * (10 - int(score))
        print(f"     ✅ Score: {score}/10  {bar}")
        print(f"     📝 {research_data['verdict'][:120]}")
        print()

    # ── Write enriched output ──
    research_map = {r["car_id"]: r for r in all_research}
    enriched = []
    for listing in listings:
        car_id = listing.get("id", "")
        if car_id in research_map:
            listing["research"] = research_map[car_id]
        enriched.append(listing)

    output_payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "query": CAR_QUERY,
        "source": "reddit.com",
        "total_listings": len(listings),
        "researched_count": len(all_research),
        "total_tavily_searches": total_searches,
        "listings": enriched,
    }

    with OUTPUT_JSON.open("w", encoding="utf-8") as f:
        json.dump(output_payload, f, ensure_ascii=False, indent=2)

    enriched_flat = stage_dir(4) / f"listings_enriched_{SLUG}.json"
    with enriched_flat.open("w", encoding="utf-8") as f:
        json.dump(enriched, f, ensure_ascii=False, indent=2)

    # Print summary
    print(f"{'='*60}")
    print(f"  ✅ Reddit Research Complete — \"{CAR_QUERY}\"")
    print(f"{'='*60}")
    print(f"   Listings researched:  {len(all_research)}/{len(listings)}")
    print(f"   Reddit searches used: {total_searches}")
    print(f"   Full report:          {OUTPUT_JSON}")
    print(f"   Enriched listings:    {enriched_flat}")

    # Scoreboard
    print(f"\n   {'Car':<40} {'Score':>6}  Verdict")
    print(f"   {'─'*40} {'─'*6}  {'─'*40}")
    for r in sorted(all_research, key=lambda x: x.get("research_score", 0), reverse=True):
        name = r.get("car_title", "?")[:38]
        score = r.get("research_score", 0)
        verdict_short = r.get("verdict", "")[:40]
        bar = "█" * int(score) + "░" * (10 - int(score))
        print(f"   {name:<40} {score:>5}/10  {bar}  {verdict_short}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
