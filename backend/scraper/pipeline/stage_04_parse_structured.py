#!/usr/bin/env python3
"""
Stage 4 — Parse structured vehicle fields from extracted Craigslist listing pages.

Reads:  data/craigslist/03_listing_pages/listing_pages.jsonl
Writes: data/craigslist/04_structured/listings_structured.jsonl
        data/craigslist/04_structured/listings_structured.json
        data/craigslist/04_structured/listings_structured.csv

Bug fixes over original:
- Title/trim: uses # header from raw_content (has real trim) instead of page <title>
- Attributes: strips markdown links — [excellent](url) → excellent
- Location: extracts from # header parens, falls back to page title city
- Phone: excludes CL post IDs (10-digit numbers starting with 791)
- Mileage: requires 100+ to avoid false positives; prefers odometer attr
"""

from __future__ import annotations

import csv
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from tavily_client import stage_dir

# ── Paths ──
INPUT_JSONL = stage_dir(3) / "listing_pages.jsonl"
OUT_DIR = stage_dir(4)
OUT_JSONL = OUT_DIR / "listings_structured.jsonl"
OUT_JSON = OUT_DIR / "listings_structured.json"
OUT_CSV = OUT_DIR / "listings_structured.csv"

# ── Regexes ──
VIN_RE = re.compile(r"\b([A-HJ-NPR-Z0-9]{17})\b")
PRICE_RE = re.compile(r"(?<!\w)\$([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?!\w)")
# Require 3+ digits to avoid matching "image 2 of 24" type false positives
MILES_RE = re.compile(r"\b([0-9]{1,3}(?:,[0-9]{3})*[0-9]{2,})\s*(?:mi|miles)\b", re.IGNORECASE)
PHONE_RE = re.compile(
    r"\b(?:\+?1[\s.-]?)?(?:\(\s*\d{3}\s*\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b"
)
# Markdown link pattern: [text](url)
MARKDOWN_LINK_RE = re.compile(r'\[([^\]]*)\]\([^)]*\)')

ATTR_LINE_RE = re.compile(
    r"(?im)^\s*(condition|cylinders|fuel|odometer|title status|transmission|drive|type|paint color|size|location):\s*(.*?)\s*$"
)
# The # header in CL individual listings: "# TITLE - $PRICE (LOCATION)"
CL_HEADER_RE = re.compile(r"(?m)^#{1,3}\s+(.+?)\s*$")
IMG_URL_RE = re.compile(
    r"https?://[^\s\"')>]+?\.(?:jpg|jpeg|png|webp)(?:\?[^\s\"')>]+)?",
    re.IGNORECASE
)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def stable_id(source: str, listing_id: str, url: str) -> str:
    if listing_id:
        return f"{source}-{listing_id}"
    h = hashlib.sha256(url.encode("utf-8")).hexdigest()[:16]
    return f"{source}-{h}"


def strip_markdown_links(s: str) -> str:
    """Convert [text](url) → text throughout a string."""
    return MARKDOWN_LINK_RE.sub(r'\1', s).strip()


def strip_tags(s: str) -> str:
    s = re.sub(r"<script\b[^>]*>.*?</script>", " ", s, flags=re.IGNORECASE | re.DOTALL)
    s = re.sub(r"<style\b[^>]*>.*?</style>", " ", s, flags=re.IGNORECASE | re.DOTALL)
    s = re.sub(r"<[^>]+>", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def choose_text(rec: Dict[str, Any]) -> str:
    raw = rec.get("raw_content") or ""
    content = rec.get("content") or ""
    text = raw if isinstance(raw, str) and raw.strip() else (content if isinstance(content, str) else "")
    if "<" in text and ">" in text:
        text = strip_tags(text)
    return text


def extract_cl_header(text: str) -> Optional[str]:
    """Extract the first # header from Craigslist page content.
    This contains the REAL listing title with trim, price, and location.
    Example: '# 2015 toyota camry se 53k white - $11,800 (san jose east)'
    """
    m = CL_HEADER_RE.search(text or "")
    return m.group(1).strip() if m else None


def extract_title(rec: Dict[str, Any], text: str) -> str:
    """Get listing title. Prefer # header (has trim info) over page <title>."""
    # First choice: # header from raw content (most detailed)
    header = extract_cl_header(text)
    if header:
        # Strip the price and location suffix for a clean title
        # "2015 toyota camry se 53k - $11,800 (san jose east)" → "2015 toyota camry se 53k"
        clean = re.sub(r'\s*-\s*\$[\d,]+.*$', '', header)
        # Also handle headers with just parens at end
        clean = re.sub(r'\s*\([^)]*\)\s*$', '', clean)
        if clean.strip():
            return clean.strip()
        return header

    # Second choice: tavily meta title
    meta = rec.get("tavily_meta") or {}
    if isinstance(meta, dict):
        for k in ("title", "page_title", "document_title"):
            v = meta.get(k)
            if isinstance(v, str) and v.strip():
                # Strip " - craigslist" suffix
                return re.sub(r'\s*-\s*craigslist\s*$', '', v.strip(), flags=re.IGNORECASE)

    # Fallback
    for line in (text or "").splitlines():
        line = line.strip()
        if line and not line.lower().startswith(
            ("share", "reply", "print", "favorite", "post id", "posted", "updated", "[cl]", "cl")
        ):
            return line[:200]
    return ""


def extract_location(rec: Dict[str, Any], text: str, attrs: Dict[str, str]) -> Optional[str]:
    """Extract location. Priority: # header parens > location attr > page title city."""
    # 1. From # header: "... (san jose east)" or "... - $PRICE (location)"
    header = extract_cl_header(text)
    if header:
        loc_match = re.search(r'\(([^)]+)\)\s*$', header)
        if loc_match:
            loc = loc_match.group(1).strip()
            # Filter out noise that ends up in parens
            noise = ['call', 'financing', 'est.', 'payment', 'oac', 'auto race',
                     'euro auto', 'we finance', 'availability', '510-', '408-',
                     'over 100']
            if not any(n in loc.lower() for n in noise):
                return loc

    # 2. From location attribute (if present and not a link)
    loc_attr = attrs.get("location")
    if loc_attr:
        return strip_markdown_links(loc_attr)

    # 3. From page title: "2016 toyota camry for sale - San Jose, CA - craigslist"
    meta = rec.get("tavily_meta") or {}
    page_title = ""
    if isinstance(meta, dict):
        page_title = meta.get("title") or meta.get("page_title") or ""

    city_match = re.search(r'-\s*([^-]+?),\s*[A-Z]{2}\s*-\s*craigslist', page_title, re.IGNORECASE)
    if city_match:
        return city_match.group(1).strip()

    return None


def parse_year_make_model_trim(title: str) -> Tuple[Optional[int], Optional[str], Optional[str], Optional[str]]:
    t = (title or "").strip()

    year = None
    m_year = re.search(r"\b(19\d{2}|20\d{2})\b", t)
    if m_year:
        try:
            year = int(m_year.group(1))
        except ValueError:
            year = None

    tl = t.lower()
    make = "Toyota" if "toyota" in tl else None
    model = "Camry" if "camry" in tl else None

    # Check for trim — order matters (most specific first)
    trim = None
    trim_candidates = [
        ("XSE", r"\bxse\b"),
        ("XLE", r"\bxle\b"),
        ("SE", r"\bse\b"),
        ("LE", r"\ble\b"),
        ("TRD", r"\btrd\b"),
        ("Nightshade", r"\bnightshade\b"),
        ("Hybrid", r"\bhybrid\b"),
    ]
    for trim_name, pattern in trim_candidates:
        if re.search(pattern, tl, flags=re.IGNORECASE):
            trim = trim_name
            break

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
    m = MILES_RE.search(text or "")
    if not m:
        return None
    try:
        val = int(m.group(1).replace(",", ""))
        return val if 100 <= val <= 500000 else None
    except ValueError:
        return None


def parse_odometer(attrs: Dict[str, str]) -> Optional[int]:
    """Parse odometer from CL attributes, handling empty values."""
    raw = attrs.get("odometer", "").strip()
    raw = strip_markdown_links(raw)
    if not raw:
        return None
    m = re.search(r"([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)", raw)
    if not m:
        return None
    try:
        val = int(m.group(1).replace(",", ""))
        return val if 100 <= val <= 500000 else None
    except ValueError:
        return None


def first_vin(text: str) -> Optional[str]:
    m = VIN_RE.search(text or "")
    return m.group(1) if m else None


def phone_numbers(text: str, post_id: str = "") -> List[str]:
    """Extract phone numbers, excluding CL post IDs which are 10-digit lookalikes."""
    nums = PHONE_RE.findall(text or "")
    cleaned = []
    seen = set()
    for n in nums:
        n2 = re.sub(r"\s+", " ", n).strip()
        digits_only = re.sub(r"\D", "", n2)

        # Skip if this is actually the post ID
        if post_id and digits_only == post_id:
            continue
        # Skip bare 10-digit numbers starting with 791 (CL post IDs)
        if re.match(r'^791\d{7}$', digits_only):
            continue

        if n2 not in seen:
            seen.add(n2)
            cleaned.append(n2)
    return cleaned


def extract_attrs(text: str) -> Dict[str, str]:
    """Extract CL attribute lines, stripping markdown links from values."""
    attrs: Dict[str, str] = {}
    for m in ATTR_LINE_RE.finditer(text or ""):
        key = m.group(1).strip().lower()
        val = m.group(2).strip()
        val = strip_markdown_links(val)
        if val:
            attrs[key] = val
    return attrs


def extract_images(text: str) -> List[str]:
    urls = IMG_URL_RE.findall(text or "")
    seen = set()
    out = []
    for u in urls:
        if u in seen:
            continue
        if '50x50' in u:
            continue
        seen.add(u)
        out.append(u)
    return out


def normalize_condition(val: Optional[str]) -> Optional[str]:
    if not val:
        return None
    v = val.lower()
    if "new" in v and "like" not in v:
        return "new"
    return "used"


def build_record(rec: Dict[str, Any]) -> Dict[str, Any]:
    source = "craigslist"
    listing_id = (rec.get("listing_id") or "").strip()
    url = (rec.get("url") or "").strip()

    text = choose_text(rec)
    title = extract_title(rec, text)

    year, make, model, trim = parse_year_make_model_trim(title)
    price_usd = first_int_from_price(text)
    mileage = first_int_from_miles(text)
    vin = first_vin(text)

    attrs = extract_attrs(text)

    odo = parse_odometer(attrs)
    if odo is not None:
        mileage = odo

    condition_raw = attrs.get("condition")
    used_new = normalize_condition(condition_raw)
    images = extract_images(text)
    description = (text[:8000] if text else "")
    location = extract_location(rec, text, attrs)

    return {
        "id": stable_id(source, listing_id, url),
        "source": source,
        "source_listing_id": listing_id or None,
        "url": url or None,
        "title": title or None,
        "year": year,
        "make": make,
        "model": model,
        "trim": trim,
        "price_usd": price_usd,
        "mileage": mileage,
        "vin": vin,
        "used_new": used_new,
        "condition_raw": condition_raw or None,
        "transmission": attrs.get("transmission"),
        "fuel": attrs.get("fuel"),
        "drive": attrs.get("drive"),
        "body_type": attrs.get("type"),
        "paint_color": attrs.get("paint color"),
        "cylinders": attrs.get("cylinders"),
        "title_status": attrs.get("title status"),
        "size": attrs.get("size"),
        "location": location,
        "seller_phone_numbers": phone_numbers(text, post_id=listing_id),
        "image_urls": images,
        "description": description or None,
        "extracted_at": rec.get("extracted_at") or None,
        "parsed_at": now_iso(),
        "tavily_meta": rec.get("tavily_meta") if isinstance(rec.get("tavily_meta"), dict) else None,
    }


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
        "id", "source", "source_listing_id", "url", "title",
        "year", "make", "model", "trim", "price_usd", "mileage", "vin",
        "used_new", "condition_raw", "transmission", "fuel", "drive",
        "body_type", "paint_color", "cylinders", "title_status", "location",
        "image_urls", "seller_phone_numbers", "description",
        "extracted_at", "parsed_at",
    ]

    def norm(v: Any) -> Any:
        if isinstance(v, (list, dict)):
            return json.dumps(v, ensure_ascii=False)
        return v

    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in rows:
            w.writerow({k: norm(r.get(k)) for k in fieldnames})


def main() -> int:
    if not INPUT_JSONL.exists():
        raise SystemExit(f"Missing input: {INPUT_JSONL} (run Stage 3 first)")

    raw_recs = read_jsonl(INPUT_JSONL)
    structured: List[Dict[str, Any]] = [build_record(rec) for rec in raw_recs]

    write_jsonl(OUT_JSONL, structured)
    write_json_array(OUT_JSON, structured)
    write_csv(OUT_CSV, structured)

    has_trim = sum(1 for r in structured if r.get("trim"))
    has_price = sum(1 for r in structured if r.get("price_usd"))
    has_loc = sum(1 for r in structured if r.get("location"))
    has_miles = sum(1 for r in structured if r.get("mileage"))
    has_phone = sum(1 for r in structured if r.get("seller_phone_numbers"))

    print(f"✅ Parsed {len(raw_recs)} listings → {OUT_DIR}")
    print(f"   Trim:     {has_trim}/{len(structured)}")
    print(f"   Price:    {has_price}/{len(structured)}")
    print(f"   Location: {has_loc}/{len(structured)}")
    print(f"   Mileage:  {has_miles}/{len(structured)}")
    print(f"   Phone:    {has_phone}/{len(structured)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())