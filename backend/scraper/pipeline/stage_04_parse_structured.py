#!/usr/bin/env python3
"""
Stage 4 — Parse structured vehicle fields from extracted Craigslist listing pages.

Reads:  data/craigslist/03_listing_pages/listing_pages_{slug}.jsonl
        CAR_QUERY env var for make/model detection
Writes: data/craigslist/04_structured/listings_structured_{slug}.jsonl
        data/craigslist/04_structured/listings_structured_{slug}.json
        data/craigslist/04_structured/listings_structured_{slug}.csv

Three-layer attribute extraction (priority: CL > dealer > natural language):

  Layer 1 — CL attribute block
    Works when Tavily returns the CL sidebar attributes.
    Two sub-modes: line-based (newlines) and inline (flattened).

  Layer 2 — Dealer bold-markdown format
    Many dealers embed **Year:** 2014, **Transmission:** Automatic, etc.

  Layer 3 — Natural language fallback
    Regex patterns for "automatic", "clean title", "sedan", etc.

Additional extractions:
  - seller_type: owner or dealer from URL (cto/ctd)
  - posted_at / updated_at: from CL page metadata
  - latitude / longitude: from Google Maps pin link

All categorical fields are normalized to lowercase canonical forms.
"""

from __future__ import annotations

import csv
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from tavily_client import stage_dir, query_slug
from trims import detect_trim

# ── Query (for make/model detection) ──
_car_query = os.environ.get("CAR_QUERY")
if not _car_query:
    print("ERROR: CAR_QUERY env var not set. Use run_pipeline.py.", file=sys.stderr)
    sys.exit(1)

SLUG = query_slug(_car_query)
_query_words = _car_query.lower().split()
QUERY_MAKE = _query_words[0] if len(_query_words) >= 1 else None
QUERY_MODEL = _query_words[1] if len(_query_words) >= 2 else None

# ── Paths ──
INPUT_JSONL = stage_dir(3) / f"listing_pages_{SLUG}.jsonl"
OUT_DIR = stage_dir(4)
OUT_JSONL = OUT_DIR / f"listings_structured_{SLUG}.jsonl"
OUT_JSON = OUT_DIR / f"listings_structured_{SLUG}.json"
OUT_CSV = OUT_DIR / f"listings_structured_{SLUG}.csv"

# ═══════════════════════════════════════════════════════════════════
#  Regexes
# ═══════════════════════════════════════════════════════════════════

VIN_RE = re.compile(r"\b([A-HJ-NPR-Z0-9]{17})\b")
PRICE_RE = re.compile(r"(?<!\w)\$([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?!\w)")
MILES_RE = re.compile(
    r"\b(\d{1,3}(?:,\d{3})+|\d{3,})\s*(?:mi|miles)\b", re.IGNORECASE
)
# Plain-text "Mileage: 36,374" or "Miles: 89000" (dealer specs without bold)
MILEAGE_LABEL_RE = re.compile(
    r"(?i)\b(?:mileage|miles?)\s*:\s*([0-9]{1,3}(?:,[0-9]{3})*[0-9]*)"
)
PHONE_RE = re.compile(
    r"\b(?:\+?1[\s.-]?)?(?:\(\s*\d{3}\s*\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b"
)
MARKDOWN_LINK_RE = re.compile(r"\[([^\]]*)\]\([^)]*\)")

# ── Layer 1: CL attribute block ──
CL_ATTR_KEYS = [
    "condition", "cylinders", "fuel", "odometer", "title status",
    "transmission", "drive", "type", "paint color", "size", "location",
]
ATTR_LINE_RE = re.compile(
    r"(?im)^\s*("
    + "|".join(re.escape(k) for k in CL_ATTR_KEYS)
    + r"):\s*(.*?)\s*$"
)
ATTR_INLINE_RE = re.compile(
    r"(?:^|(?<=\s))("
    + "|".join(re.escape(k) for k in CL_ATTR_KEYS)
    + r"):\s*",
    re.IGNORECASE,
)
ATTR_VALUE_STOPS = [
    " posted ", " more ads ", " ◀", " ▶", " ▲", " favorite",
    " hide ", " flag", " print", "\n", " QR ", " share ",
    " do NOT ", " ©", " craigslist",
]

# ── Layer 2: Dealer bold-markdown (**Key:** Value) ──
DEALER_BOLD_RE = re.compile(
    r"\*\*([^*:]{2,30}?)(?::\*\*|\*\*:)\s*(.*?)(?:\n|$)"
)
DEALER_KEY_MAP: Dict[str, str] = {
    "transmission": "transmission", "trans": "transmission",
    "transmission type": "transmission",
    "condition": "condition",
    "drive": "drive", "drivetrain": "drive",
    "mileage": "odometer", "odometer": "odometer",
    "body": "type", "body style": "type",
    "exterior": "paint color", "exterior color": "paint color",
    "color": "paint color",
    "engine": "cylinders", "cylinders": "cylinders",
    "fuel": "fuel",
}

# ── Layer 3: Natural language fallbacks ──
NL_PATTERNS: Dict[str, re.Pattern] = {
    "transmission": re.compile(
        r"(?i)\b(automatic|manual|cvt|6[\s-]?speed|5[\s-]?speed|4[\s-]?speed)\b"
    ),
    "title status": re.compile(
        r"(?i)\b(clean\s+title|salvage\s+title|rebuilt\s+title|branded\s+title)\b"
    ),
    "cylinders": re.compile(
        r"(?i)\b(4[\s-]?cyl(?:inder)?s?|6[\s-]?cyl(?:inder)?s?"
        r"|8[\s-]?cyl(?:inder)?s?|v[\s-]?6|v[\s-]?8|i[\s-]?4"
        r"|inline[\s-]?4|2\.4l?|1\.5l?|3\.5l?|2\.0l?|1\.8l?)\b"
    ),
    "fuel": re.compile(
        r"(?i)\b(gas(?:oline)?|diesel|hybrid|electric|plug[\s-]?in)\b"
    ),
    "drive": re.compile(
        r"(?i)\b(fwd|awd|4wd|rwd|2wd"
        r"|front[\s-]?wheel[\s-]?drive|all[\s-]?wheel[\s-]?drive"
        r"|four[\s-]?wheel[\s-]?drive|rear[\s-]?wheel[\s-]?drive)\b"
    ),
    "type": re.compile(
        r"(?i)\b(sedan|coupe|suv|hatchback|wagon|convertible)\b"
    ),
}

# ── Metadata extraction ──
CL_HEADER_RE = re.compile(r"(?m)^#{1,3}\s+(.+?)\s*$")
IMG_URL_RE = re.compile(
    r"https?://[^\s\"')>]+?\.(?:jpg|jpeg|png|webp)(?:\?[^\s\"')>]+)?",
    re.IGNORECASE,
)
POSTED_RE = re.compile(
    r"(?i)(?:^|\n)\s*posted\s*[:\n]?\s*(20\d{2}-\d{2}-\d{2}[\sT]?\d{2}:\d{2})"
)
UPDATED_RE = re.compile(
    r"(?i)(?:^|\n)\s*updated\s*[:\n]?\s*(20\d{2}-\d{2}-\d{2}[\sT]?\d{2}:\d{2})"
)
GMAP_RE = re.compile(
    r"https?://www\.google\.com/maps/search/([-\d.]+),([-\d.]+)"
)
SELLER_TYPE_RE = re.compile(r"/(cto|ctd)/")


# ═══════════════════════════════════════════════════════════════════
#  Helpers
# ═══════════════════════════════════════════════════════════════════


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def stable_id(source: str, listing_id: str, url: str) -> str:
    if listing_id:
        return f"{source}-{listing_id}"
    h = hashlib.sha256(url.encode("utf-8")).hexdigest()[:16]
    return f"{source}-{h}"


def strip_markdown_links(s: str) -> str:
    """[text](url) → text"""
    return MARKDOWN_LINK_RE.sub(r"\1", s).strip()


def strip_tags(s: str) -> str:
    s = re.sub(r"<script\b[^>]*>.*?</script>", " ", s, flags=re.I | re.DOTALL)
    s = re.sub(r"<style\b[^>]*>.*?</style>", " ", s, flags=re.I | re.DOTALL)
    s = re.sub(r"<[^>]+>", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def clean_dealer_val(v: str) -> str:
    """Truncate dealer bold values at common trailing boundaries.

    Dealer bold format sometimes bleeds into the next field:
    **Drive:** FWD * Engine: 2.0L  →  should be just "FWD"
    """
    for sep in (" * ", "**", " | ", " - "):
        idx = v.find(sep)
        if idx > 0:
            v = v[:idx]
    # Also truncate at lowercase key-like patterns: " miles:", " vin:", " engine:"
    m = re.search(r"\s+(?:miles|vin|engine|fuel|mpg|title|options|door)\s*:", v, re.I)
    if m and m.start() > 0:
        v = v[:m.start()]
    return v.strip().rstrip("*").strip()


def choose_text(rec: Dict[str, Any]) -> str:
    raw = rec.get("raw_content") or ""
    content = rec.get("content") or ""
    text = raw if isinstance(raw, str) and raw.strip() else (
        content if isinstance(content, str) else ""
    )
    if "<" in text and ">" in text:
        text = strip_tags(text)
    return text


# ═══════════════════════════════════════════════════════════════════
#  Three-layer attribute extraction
# ═══════════════════════════════════════════════════════════════════


def _parse_cl_attrs(text: str) -> Dict[str, str]:
    """Layer 1: CL attribute block (line-based + inline fallback)."""
    attrs: Dict[str, str] = {}
    for m in ATTR_LINE_RE.finditer(text or ""):
        key = m.group(1).strip().lower()
        val = strip_markdown_links(m.group(2).strip())
        if val:
            attrs[key] = val
    if len(attrs) >= 3:
        return attrs

    matches = list(ATTR_INLINE_RE.finditer(text or ""))
    if not matches:
        return attrs
    for i, m in enumerate(matches):
        key = m.group(1).strip().lower()
        val_start = m.end()
        val_end = (
            matches[i + 1].start()
            if i + 1 < len(matches)
            else min(val_start + 80, len(text))
        )
        val = strip_markdown_links(text[val_start:val_end].strip())
        for stop in ATTR_VALUE_STOPS:
            idx = val.lower().find(stop.lower())
            if idx > 0:
                val = val[:idx].strip()
        val = val.rstrip(". ")
        if val and key not in attrs:
            attrs[key] = val
    return attrs


def _parse_dealer_attrs(text: str) -> Dict[str, str]:
    """Layer 2: Dealer bold-markdown (**Key:** Value)."""
    attrs: Dict[str, str] = {}
    for m in DEALER_BOLD_RE.finditer(text or ""):
        dk = m.group(1).strip()
        val = clean_dealer_val(m.group(2).strip())
        ck = DEALER_KEY_MAP.get(dk.lower())
        if ck and val and ck not in attrs:
            attrs[ck] = val
    return attrs


def _parse_nl_attrs(text: str) -> Dict[str, str]:
    """Layer 3: Natural language fallbacks."""
    attrs: Dict[str, str] = {}
    for key, pat in NL_PATTERNS.items():
        m = pat.search(text or "")
        if m:
            attrs[key] = m.group(1)
    return attrs


def extract_all_attrs(text: str) -> Dict[str, str]:
    """Merge attributes from all three layers (CL > dealer > NL)."""
    cl = _parse_cl_attrs(text)
    dealer = _parse_dealer_attrs(text)
    nl = _parse_nl_attrs(text)
    merged: Dict[str, str] = {}
    for key in set(cl) | set(dealer) | set(nl):
        merged[key] = cl.get(key) or dealer.get(key) or nl.get(key) or ""
    return {k: v for k, v in merged.items() if v}


# ═══════════════════════════════════════════════════════════════════
#  Normalization — strict canonical forms, reject garbage
# ═══════════════════════════════════════════════════════════════════


def norm_transmission(val: Optional[str]) -> Optional[str]:
    if not val:
        return None
    v = clean_dealer_val(val).lower().strip()
    if v in ("automatic", "auto"):
        return "automatic"
    if v in ("manual", "standard", "stick"):
        return "manual"
    if "cvt" in v or "continuously" in v:
        return "cvt"
    m = re.match(r"(\d)[\s-]?speed", v)
    if m:
        return f"{m.group(1)}-speed"
    if v == "other":
        return "other"
    return None  # reject garbage


def norm_fuel(val: Optional[str]) -> Optional[str]:
    if not val:
        return None
    v = re.sub(r"[^\w\s-]", "", clean_dealer_val(val)).strip().lower()
    if v in ("gas", "gasoline"):
        return "gas"
    if "diesel" in v:
        return "diesel"
    if "hybrid" in v or "plug" in v:
        return "hybrid"
    if "electric" in v:
        return "electric"
    if v in ("other", "flex"):
        return v
    return None


def norm_drive(val: Optional[str]) -> Optional[str]:
    if not val:
        return None
    v = clean_dealer_val(val).lower().replace("-", " ").strip()
    if v == "fwd" or "front wheel" in v:
        return "fwd"
    if v == "awd" or "all wheel" in v:
        return "awd"
    if v in ("4wd", "4x4") or "four wheel" in v:
        return "4wd"
    if v == "rwd" or "rear wheel" in v:
        return "rwd"
    if v == "2wd":
        return "2wd"
    return None


def norm_body_type(val: Optional[str]) -> Optional[str]:
    if not val:
        return None
    v = clean_dealer_val(val).lower().strip()
    if "sedan" in v or "4d" in v or "4 d" in v:
        return "sedan"
    if "coupe" in v or "2d" in v or "2 d" in v:
        return "coupe"
    if "suv" in v:
        return "suv"
    if "hatch" in v:
        return "hatchback"
    if "wagon" in v:
        return "wagon"
    if "convert" in v:
        return "convertible"
    if "pickup" in v or "truck" in v:
        return "truck"
    if "van" in v or "mini" in v:
        return "van"
    if v == "other":
        return "other"
    return None  # reject "certified", "used", etc.


def norm_condition(val: Optional[str]) -> Optional[str]:
    if not val:
        return None
    v = clean_dealer_val(val).lower().strip()
    canonical = {
        "excellent": "excellent", "good": "good", "fair": "fair",
        "like new": "like new", "new": "new", "salvage": "salvage",
        "used": "used",
    }
    for key, canon in canonical.items():
        if key in v:
            return canon
    return v


def norm_used_new(condition_raw: Optional[str]) -> Optional[str]:
    if not condition_raw:
        return None
    return "new" if condition_raw == "new" else "used"


def norm_title_status(val: Optional[str]) -> Optional[str]:
    if not val:
        return None
    v = clean_dealer_val(val).lower().strip()
    if "clean" in v:
        return "clean"
    if "salvage" in v:
        return "salvage"
    if "rebuilt" in v:
        return "rebuilt"
    if "branded" in v:
        return "branded"
    if "lien" in v:
        return "lien"
    if "missing" in v:
        return "missing"
    return v


def norm_cylinders(val: Optional[str]) -> Optional[str]:
    if not val:
        return None
    v = clean_dealer_val(val).lower().strip()
    # "4 cylinders", "6-cylinder" → "N cylinders"
    m = re.search(r"(\d+)\s*[\s-]?cyl", v)
    if m:
        return f"{m.group(1)} cylinders"
    # "V6", "V8" → "N cylinders"
    m = re.search(r"v[\s-]?(\d+)", v)
    if m:
        return f"{m.group(1)} cylinders"
    # "I4", "inline-4" → "N cylinders"
    m = re.search(r"i[\s-]?(\d+)|inline[\s-]?(\d+)", v)
    if m:
        return f"{(m.group(1) or m.group(2))} cylinders"
    # "2.4L", "1.5l" → displacement
    m = re.search(r"(\d\.\d)\s*l", v)
    if m:
        return f"{m.group(1)}L"
    # Bare digit "4", "6"
    if re.match(r"^\d$", v):
        return f"{v} cylinders"
    # Bare displacement "1.5", "2.4"
    m = re.match(r"^(\d\.\d)$", v)
    if m:
        return f"{m.group(1)}L"
    return None


def norm_paint_color(val: Optional[str]) -> Optional[str]:
    if not val:
        return None
    v = clean_dealer_val(val).lower().strip()
    # Map dealer fancy names to simple colors
    color_map = {
        "white": "white", "black": "black", "silver": "silver",
        "gray": "gray", "grey": "gray", "red": "red", "blue": "blue",
        "green": "green", "brown": "brown", "gold": "gold",
        "beige": "beige", "orange": "orange", "purple": "purple",
        "tan": "tan", "maroon": "maroon", "burgundy": "burgundy",
        "champagne": "gold", "charcoal": "gray",
    }
    for keyword, canonical in color_map.items():
        if keyword in v:
            return canonical
    if v in ("custom", "other"):
        return v
    # Return cleaned value for uncommon colors (e.g. "platinum pearl")
    return v if len(v) < 40 else None


# ═══════════════════════════════════════════════════════════════════
#  Field extractors
# ═══════════════════════════════════════════════════════════════════


def extract_cl_header(text: str) -> Optional[str]:
    m = CL_HEADER_RE.search(text or "")
    return m.group(1).strip() if m else None


def extract_title(rec: Dict[str, Any], text: str) -> str:
    header = extract_cl_header(text)
    if header:
        clean = re.sub(r"\s*-\s*\$[\d,]+.*$", "", header)
        clean = re.sub(r"\s*\([^)]*\)\s*$", "", clean)
        if clean.strip():
            return clean.strip()
        return header

    meta = rec.get("tavily_meta") or {}
    if isinstance(meta, dict):
        for k in ("title", "page_title", "document_title"):
            v = meta.get(k)
            if isinstance(v, str) and v.strip():
                return re.sub(
                    r"\s*-\s*craigslist\s*$", "", v.strip(), flags=re.I
                )

    for line in (text or "").splitlines():
        line = line.strip()
        if line and not line.lower().startswith(
            ("share", "reply", "print", "favorite", "post id",
             "posted", "updated", "[cl]", "cl")
        ):
            return line[:200]
    return ""


def extract_location(
    rec: Dict[str, Any], text: str, attrs: Dict[str, str]
) -> Optional[str]:
    header = extract_cl_header(text)
    if header:
        loc_match = re.search(r"\(([^)]+)\)\s*$", header)
        if loc_match:
            loc = loc_match.group(1).strip()
            noise = [
                "call", "financing", "est.", "payment", "oac", "auto race",
                "euro auto", "we finance", "availability", "510-", "408-",
                "over 100",
            ]
            if not any(n in loc.lower() for n in noise):
                return loc

    loc_attr = attrs.get("location")
    if loc_attr:
        return strip_markdown_links(loc_attr)

    meta = rec.get("tavily_meta") or {}
    page_title = ""
    if isinstance(meta, dict):
        page_title = meta.get("title") or meta.get("page_title") or ""
    city_match = re.search(
        r"-\s*([^-]+?),\s*[A-Z]{2}\s*-\s*craigslist", page_title, re.I
    )
    if city_match:
        return city_match.group(1).strip()
    return None


def extract_coords(text: str) -> Tuple[Optional[float], Optional[float]]:
    """Extract lat/lng from Google Maps pin link embedded in CL page."""
    m = GMAP_RE.search(text or "")
    if m:
        try:
            return float(m.group(1)), float(m.group(2))
        except ValueError:
            pass
    return None, None


def extract_seller_type(url: str) -> Optional[str]:
    """owner (cto) or dealer (ctd) from listing URL."""
    m = SELLER_TYPE_RE.search(url or "")
    if m:
        return "owner" if m.group(1) == "cto" else "dealer"
    return None


def extract_posted_at(text: str) -> Optional[str]:
    m = POSTED_RE.search(text or "")
    if m:
        return m.group(1).strip().replace(" ", "T")
    return None


def extract_updated_at(text: str) -> Optional[str]:
    m = UPDATED_RE.search(text or "")
    if m:
        return m.group(1).strip().replace(" ", "T")
    return None


def parse_year_make_model_trim(
    title: str,
) -> Tuple[Optional[int], Optional[str], Optional[str], Optional[str]]:
    t = (title or "").strip()
    year = None
    m_year = re.search(r"\b(19\d{2}|20\d{2})\b", t)
    if m_year:
        try:
            year = int(m_year.group(1))
        except ValueError:
            year = None

    tl = t.lower()
    make = QUERY_MAKE.title() if QUERY_MAKE and QUERY_MAKE in tl else None
    model = QUERY_MODEL.title() if QUERY_MODEL and QUERY_MODEL in tl else None
    trim = detect_trim(t, make=make)
    return year, make, model, trim


def first_int_from_price(text: str) -> Optional[int]:
    m = PRICE_RE.search(text or "")
    if not m:
        return None
    try:
        val = int(m.group(1).replace(",", ""))
        return val if val >= 500 else None
    except ValueError:
        return None


def first_int_from_miles(text: str) -> Optional[int]:
    """Extract mileage from 'N miles' in text, skipping return-policy language.

    Skips false positives like '5 days or 250 miles' (money-back guarantees).
    """
    for m in MILES_RE.finditer(text or ""):
        # Context check: skip "X days/hours or N miles" (return policy)
        pre = text[max(0, m.start() - 20):m.start()].lower()
        if " or " in pre and any(
            w in pre for w in ("day", "hour", "week", "month")
        ):
            continue
        try:
            val = int(m.group(1).replace(",", ""))
            if 100 <= val <= 500000:
                return val
        except ValueError:
            continue
    return None


def extract_labeled_mileage(text: str) -> Optional[int]:
    """Extract mileage from 'Mileage: N' or 'MILEAGE: N' labels.

    Catches plain-text dealer specifications that aren't bold-markdown
    and don't use CL's 'odometer:' key.
    """
    m = MILEAGE_LABEL_RE.search(text or "")
    if m:
        try:
            val = int(m.group(1).replace(",", ""))
            if 100 <= val <= 500000:
                return val
        except ValueError:
            pass
    return None


def parse_odometer(attrs: Dict[str, str]) -> Optional[int]:
    raw = attrs.get("odometer", "").strip()
    raw = strip_markdown_links(raw)
    if not raw:
        return None
    m = re.search(r"([0-9]{1,3}(?:[,.]?[0-9]{3})+|[0-9]+)", raw)
    if not m:
        return None
    try:
        cleaned = m.group(1).replace(",", "").replace(".", "")
        val = int(cleaned)
        return val if 100 <= val <= 500000 else None
    except ValueError:
        return None


def first_vin(text: str) -> Optional[str]:
    # **VIN:VALUE** (dealer, no space)
    m = re.search(r"\*\*VIN:?\s*\*?\*?\s*([A-HJ-NPR-Z0-9]{17})\b", text or "")
    if m:
        return m.group(1)
    # **VIN:** VALUE (dealer, with space)
    for dm in DEALER_BOLD_RE.finditer(text or ""):
        if dm.group(1).strip().lower() == "vin":
            val = dm.group(2).strip().rstrip("*").strip()
            vm = VIN_RE.search(val)
            if vm:
                return vm.group(1)
    # General VIN anywhere in text
    m = VIN_RE.search(text or "")
    return m.group(1) if m else None


def phone_numbers(text: str, post_id: str = "") -> List[str]:
    nums = PHONE_RE.findall(text or "")
    cleaned = []
    seen: set = set()
    for n in nums:
        n2 = re.sub(r"\s+", " ", n).strip()
        digits_only = re.sub(r"\D", "", n2)
        if post_id and digits_only == post_id:
            continue
        if re.match(r"^791\d{7}$", digits_only):
            continue
        if n2 not in seen:
            seen.add(n2)
            cleaned.append(n2)
    return cleaned


def extract_images(text: str) -> List[str]:
    urls = IMG_URL_RE.findall(text or "")
    seen: set = set()
    out = []
    for u in urls:
        if u in seen or "50x50" in u:
            continue
        seen.add(u)
        out.append(u)
    return out


# ═══════════════════════════════════════════════════════════════════
#  Record builder
# ═══════════════════════════════════════════════════════════════════


def build_record(rec: Dict[str, Any]) -> Dict[str, Any]:
    source = "craigslist"
    listing_id = (rec.get("listing_id") or "").strip()
    url = (rec.get("url") or "").strip()

    text = choose_text(rec)
    title = extract_title(rec, text)

    year, make, model, trim = parse_year_make_model_trim(title)
    price_usd = first_int_from_price(text)

    # Three-layer attribute extraction
    attrs = extract_all_attrs(text)

    # Mileage priority: CL odometer attr → labeled "Mileage: N" → "N miles" in text
    odo = parse_odometer(attrs)
    labeled_mi = extract_labeled_mileage(text)
    text_mi = first_int_from_miles(text)
    mileage = odo or labeled_mi or text_mi

    vin = first_vin(text)

    # Normalized values (strict: returns None for garbage)
    condition_raw = norm_condition(attrs.get("condition"))
    used_new = norm_used_new(condition_raw)
    transmission = norm_transmission(attrs.get("transmission"))
    fuel = norm_fuel(attrs.get("fuel"))
    drive = norm_drive(attrs.get("drive"))
    body_type = norm_body_type(attrs.get("type"))
    paint_color = norm_paint_color(attrs.get("paint color"))
    cylinders = norm_cylinders(attrs.get("cylinders"))
    title_status = norm_title_status(attrs.get("title status"))
    size = (attrs.get("size") or "").lower().strip() or None

    # Location + coordinates
    location = extract_location(rec, text, attrs)
    latitude, longitude = extract_coords(text)

    # Metadata
    seller_type = extract_seller_type(url)
    posted_at = extract_posted_at(text)
    updated_at = extract_updated_at(text)

    images = extract_images(text)
    description = text[:8000] if text else ""

    return {
        "id": stable_id(source, listing_id, url),
        "source": source,
        "source_listing_id": listing_id or None,
        "url": url or None,
        "seller_type": seller_type,
        "posted_at": posted_at,
        "updated_at": updated_at,
        "title": title or None,
        "year": year,
        "make": make,
        "model": model,
        "trim": trim,
        "price_usd": price_usd,
        "mileage": mileage,
        "vin": vin,
        "used_new": used_new,
        "condition_raw": condition_raw,
        "transmission": transmission,
        "fuel": fuel,
        "drive": drive,
        "body_type": body_type,
        "paint_color": paint_color,
        "cylinders": cylinders,
        "title_status": title_status,
        "size": size,
        "location": location,
        "latitude": latitude,
        "longitude": longitude,
        "seller_phone_numbers": phone_numbers(text, post_id=listing_id),
        "image_urls": images,
        "description": description or None,
        "extracted_at": rec.get("extracted_at") or None,
        "parsed_at": now_iso(),
        "tavily_meta": (
            rec.get("tavily_meta")
            if isinstance(rec.get("tavily_meta"), dict)
            else None
        ),
    }


# ═══════════════════════════════════════════════════════════════════
#  I/O
# ═══════════════════════════════════════════════════════════════════


def read_jsonl(path: Path) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def write_jsonl(path: Path, rows: List[Dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


def write_json_array(path: Path, rows: List[Dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=2)


def write_csv(path: Path, rows: List[Dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "id", "source", "source_listing_id", "url", "seller_type",
        "posted_at", "updated_at", "title",
        "year", "make", "model", "trim", "price_usd", "mileage", "vin",
        "used_new", "condition_raw", "transmission", "fuel", "drive",
        "body_type", "paint_color", "cylinders", "title_status", "size",
        "location", "latitude", "longitude",
        "image_urls", "seller_phone_numbers", "description",
        "extracted_at", "parsed_at",
    ]

    def norm(k: str, v: Any) -> Any:
        if isinstance(v, (list, dict)):
            return json.dumps(v, ensure_ascii=False)
        if k == "description" and isinstance(v, str):
            flat = re.sub(r"\s+", " ", v).strip()
            return flat[:500] if len(flat) > 500 else flat
        return v

    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in rows:
            w.writerow({k: norm(k, r.get(k)) for k in fieldnames})


# ═══════════════════════════════════════════════════════════════════
#  Main
# ═══════════════════════════════════════════════════════════════════


def main() -> int:
    if not INPUT_JSONL.exists():
        raise SystemExit(f"Missing input: {INPUT_JSONL}\nRun Stage 3 first.")

    raw_recs = read_jsonl(INPUT_JSONL)
    structured: List[Dict[str, Any]] = [build_record(rec) for rec in raw_recs]

    write_jsonl(OUT_JSONL, structured)
    write_json_array(OUT_JSON, structured)
    write_csv(OUT_CSV, structured)

    # ── Full attribute audit ──
    n = len(structured)
    audit_fields = [
        ("year",         lambda r: r.get("year")),
        ("make",         lambda r: r.get("make")),
        ("model",        lambda r: r.get("model")),
        ("trim",         lambda r: r.get("trim")),
        ("price_usd",    lambda r: r.get("price_usd")),
        ("mileage",      lambda r: r.get("mileage")),
        ("vin",          lambda r: r.get("vin")),
        ("condition",    lambda r: r.get("condition_raw")),
        ("used_new",     lambda r: r.get("used_new")),
        ("transmission", lambda r: r.get("transmission")),
        ("fuel",         lambda r: r.get("fuel")),
        ("drive",        lambda r: r.get("drive")),
        ("body_type",    lambda r: r.get("body_type")),
        ("paint_color",  lambda r: r.get("paint_color")),
        ("cylinders",    lambda r: r.get("cylinders")),
        ("title_status", lambda r: r.get("title_status")),
        ("size",         lambda r: r.get("size")),
        ("location",     lambda r: r.get("location")),
        ("latitude",     lambda r: r.get("latitude")),
        ("longitude",    lambda r: r.get("longitude")),
        ("seller_type",  lambda r: r.get("seller_type")),
        ("posted_at",    lambda r: r.get("posted_at")),
        ("updated_at",   lambda r: r.get("updated_at")),
        ("phone",        lambda r: r.get("seller_phone_numbers")),
        ("images",       lambda r: r.get("image_urls")),
    ]

    print(f"\n✅ Parsed {len(raw_recs)} listings for \"{_car_query}\" → {OUT_DIR}")
    print(f"\n   {'Field':<22s} {'Filled':>6s} {'Pct':>5s}")
    print(f"   {'─' * 22} {'─' * 6} {'─' * 5}")
    for label, fn in audit_fields:
        count = sum(1 for r in structured if fn(r))
        pct = count * 100 // n if n else 0
        bar = "█" * (pct // 5) + "░" * (20 - pct // 5)
        print(f"   {label:<22s} {count:>4}/{n:<4} {pct:>3}% {bar}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())