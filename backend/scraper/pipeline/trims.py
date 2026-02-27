"""
Trim registry — maps make → ordered list of (trim_name, regex_pattern).

Order matters: most specific first so "EX-L" matches before "EX",
"XSE" before "SE", etc.

Usage:
    from trims import detect_trim
    trim = detect_trim("2024 Toyota Camry SE Nightshade", make="Toyota")
    # → "SE Nightshade"  (matches "SE" first, then appends "Nightshade" as sub-trim)
"""

import re
from typing import Optional

# ── Trim definitions by make ──
# Each entry: (display_name, regex_pattern)
# Listed most-specific-first within each make.

TOYOTA_TRIMS = [
    ("XSE", r"\bxse\b"),
    ("XLE", r"\bxle\b"),
    ("TRD Off-Road", r"\btrd\s*off[\s-]*road\b"),
    ("TRD Sport", r"\btrd\s*sport\b"),
    ("TRD Pro", r"\btrd\s*pro\b"),
    ("TRD", r"\btrd\b"),
    ("SE Nightshade", r"\bse\s+nightshade\b"),
    ("Nightshade", r"\bnightshade\b"),
    ("SE", r"\bse\b"),
    ("LE", r"\ble\b"),
    ("SR5", r"\bsr5\b"),
    ("SR", r"\bsr\b"),
    ("Limited", r"\blimited\b"),
    ("Platinum", r"\bplatinum\b"),
    ("Premium", r"\bpremium\b"),
    ("1794 Edition", r"\b1794\b"),
    ("Trail Edition", r"\btrail\s*edition\b"),
    ("Hybrid", r"\bhybrid\b"),
    ("Prime", r"\bprime\b"),
]

HONDA_TRIMS = [
    ("Type R", r"\btype[\s-]*r\b"),
    ("Si", r"\bsi\b"),
    ("EX-L", r"\bex[\s-]*l\b"),
    ("EX-T", r"\bex[\s-]*t\b"),
    ("EX", r"\bex\b"),
    ("LX", r"\blx\b"),
    ("DX", r"\bdx\b"),
    ("Sport Touring", r"\bsport\s+touring\b"),
    ("Touring", r"\btouring\b"),
    ("Sport", r"\bsport\b"),
    ("Hybrid", r"\bhybrid\b"),
]

FORD_TRIMS = [
    ("Shelby GT500", r"\bshelby\s*gt\s*500\b"),
    ("Shelby GT350", r"\bshelby\s*gt\s*350\b"),
    ("Shelby", r"\bshelby\b"),
    ("GT Premium", r"\bgt\s+premium\b"),
    ("GT", r"\bgt\b"),
    ("Raptor", r"\braptor\b"),
    ("Tremor", r"\btremor\b"),
    ("King Ranch", r"\bking\s*ranch\b"),
    ("Platinum", r"\bplatinum\b"),
    ("Limited", r"\blimited\b"),
    ("Lariat", r"\blariat\b"),
    ("XLT", r"\bxlt\b"),
    ("XL", r"\bxl\b"),
    ("SEL", r"\bsel\b"),
    ("SE", r"\bse\b"),
    ("ST", r"\bst\b"),
    ("SHO", r"\bsho\b"),
    ("Titanium", r"\btitanium\b"),
    ("Hybrid", r"\bhybrid\b"),
    ("EcoBoost", r"\becoboost\b"),
]

CHEVROLET_TRIMS = [
    ("ZL1", r"\bzl1\b"),
    ("SS 1LE", r"\bss\s*1le\b"),
    ("SS", r"\bss\b"),
    ("Z71", r"\bz71\b"),
    ("Z06", r"\bz06\b"),
    ("ZR2", r"\bzr2\b"),
    ("RST", r"\brst\b"),
    ("RS", r"\brs\b"),
    ("LT", r"\blt\b"),
    ("LS", r"\bls\b"),
    ("LTZ", r"\bltz\b"),
    ("High Country", r"\bhigh\s*country\b"),
    ("Trail Boss", r"\btrail\s*boss\b"),
    ("Premier", r"\bpremier\b"),
    ("Activ", r"\bactiv\b"),
    ("Hybrid", r"\bhybrid\b"),
]

HYUNDAI_TRIMS = [
    ("N Line", r"\bn[\s-]*line\b"),
    ("N", r"\b(?<![a-z])n(?![a-z])\b"),
    ("Calligraphy", r"\bcalligraphy\b"),
    ("Limited", r"\blimited\b"),
    ("SEL Premium", r"\bsel\s+premium\b"),
    ("SEL Convenience", r"\bsel\s+convenience\b"),
    ("SEL", r"\bsel\b"),
    ("SE", r"\bse\b"),
    ("Blue", r"\bblue\b"),
    ("Hybrid", r"\bhybrid\b"),
]

KIA_TRIMS = [
    ("GT-Line", r"\bgt[\s-]*line\b"),
    ("GT", r"\bgt\b"),
    ("SX Prestige", r"\bsx\s+prestige\b"),
    ("SX", r"\bsx\b"),
    ("EX Premium", r"\bex\s+premium\b"),
    ("EX", r"\bex\b"),
    ("LXS", r"\blxs\b"),
    ("LX", r"\blx\b"),
    ("S", r"\b(?<![a-z])s(?![a-z])\b"),
    ("Hybrid", r"\bhybrid\b"),
]

NISSAN_TRIMS = [
    ("NISMO", r"\bnismo\b"),
    ("Midnight Edition", r"\bmidnight\s*edition\b"),
    ("Platinum", r"\bplatinum\b"),
    ("SL", r"\bsl\b"),
    ("SV", r"\bsv\b"),
    ("SR", r"\bsr\b"),
    ("S", r"\b(?<![a-z])s(?![a-z])\b"),
    ("PRO-4X", r"\bpro[\s-]*4x\b"),
    ("PRO-X", r"\bpro[\s-]*x\b"),
    ("Rock Creek", r"\brock\s*creek\b"),
    ("Hybrid", r"\bhybrid\b"),
]

SUBARU_TRIMS = [
    ("STI", r"\bsti\b"),
    ("WRX", r"\bwrx\b"),
    ("Limited", r"\blimited\b"),
    ("Touring", r"\btouring\b"),
    ("Premium", r"\bpremium\b"),
    ("Sport", r"\bsport\b"),
    ("Wilderness", r"\bwilderness\b"),
    ("Onyx Edition", r"\bonyx\s*edition\b"),
    ("Base", r"\bbase\b"),
]

BMW_TRIMS = [
    ("M Competition", r"\bm\s*competition\b"),
    ("M Sport", r"\bm[\s-]*sport\b"),
    ("M", r"\b(?<![a-z])m(?![a-z0-9])\b"),
    ("xDrive", r"\bxdrive\b"),
    ("sDrive", r"\bsdrive\b"),
]

MERCEDES_TRIMS = [
    ("AMG", r"\bamg\b"),
    ("4MATIC", r"\b4matic\b"),
]

AUDI_TRIMS = [
    ("Prestige", r"\bprestige\b"),
    ("Premium Plus", r"\bpremium\s+plus\b"),
    ("Premium", r"\bpremium\b"),
    ("S Line", r"\bs[\s-]*line\b"),
    ("quattro", r"\bquattro\b"),
]

VOLKSWAGEN_TRIMS = [
    ("GLI Autobahn", r"\bgli\s+autobahn\b"),
    ("GLI", r"\bgli\b"),
    ("GTI Autobahn", r"\bgti\s+autobahn\b"),
    ("GTI", r"\bgti\b"),
    ("SEL Premium", r"\bsel\s+premium\b"),
    ("SEL R-Line", r"\bsel\s+r[\s-]*line\b"),
    ("R-Line", r"\br[\s-]*line\b"),
    ("SEL", r"\bsel\b"),
    ("SE", r"\bse\b"),
    ("S", r"\b(?<![a-z])s(?![a-z])\b"),
]

MAZDA_TRIMS = [
    ("Grand Touring", r"\bgrand\s+touring\b"),
    ("Carbon Edition", r"\bcarbon\s+edition\b"),
    ("Turbo Premium Plus", r"\bturbo\s+premium\s+plus\b"),
    ("Turbo Premium", r"\bturbo\s+premium\b"),
    ("Turbo", r"\bturbo\b"),
    ("Preferred", r"\bpreferred\b"),
    ("Premium", r"\bpremium\b"),
    ("Select", r"\bselect\b"),
    ("Sport", r"\bsport\b"),
    ("Base", r"\bbase\b"),
]

DODGE_TRIMS = [
    ("Hellcat Redeye", r"\bhellcat\s*redeye\b"),
    ("Hellcat", r"\bhellcat\b"),
    ("Scat Pack", r"\bscat\s*pack\b"),
    ("R/T", r"\br/?t\b"),
    ("GT", r"\bgt\b"),
    ("SXT", r"\bsxt\b"),
    ("SE", r"\bse\b"),
]

JEEP_TRIMS = [
    ("Rubicon 392", r"\brubicon\s*392\b"),
    ("Rubicon", r"\brubicon\b"),
    ("Sahara", r"\bsahara\b"),
    ("Willys", r"\bwillys\b"),
    ("Trailhawk", r"\btrailhawk\b"),
    ("Overland", r"\boverland\b"),
    ("Summit", r"\bsummit\b"),
    ("Limited", r"\blimited\b"),
    ("Latitude", r"\blatitude\b"),
    ("Sport S", r"\bsport\s+s\b"),
    ("Sport", r"\bsport\b"),
]

GMC_TRIMS = [
    ("AT4X", r"\bat4x\b"),
    ("AT4", r"\bat4\b"),
    ("Denali Ultimate", r"\bdenali\s+ultimate\b"),
    ("Denali", r"\bdenali\b"),
    ("SLT", r"\bslt\b"),
    ("SLE", r"\bsle\b"),
    ("Elevation", r"\belevation\b"),
]

RAM_TRIMS = [
    ("TRX", r"\btrx\b"),
    ("Rebel", r"\brebel\b"),
    ("Laramie", r"\blaramie\b"),
    ("Longhorn", r"\blonghorn\b"),
    ("Limited", r"\blimited\b"),
    ("Big Horn", r"\bbig\s*horn\b"),
    ("Tradesman", r"\btradesman\b"),
]

TESLA_TRIMS = [
    ("Plaid", r"\bplaid\b"),
    ("Performance", r"\bperformance\b"),
    ("Long Range", r"\blong\s*range\b"),
    ("Standard Range Plus", r"\bstandard\s*range\s*plus\b"),
    ("Standard Range", r"\bstandard\s*range\b"),
]

LEXUS_TRIMS = [
    ("F Sport", r"\bf[\s-]*sport\b"),
    ("Luxury", r"\bluxury\b"),
    ("Premium", r"\bpremium\b"),
    ("Base", r"\bbase\b"),
    ("Hybrid", r"\bhybrid\b"),
]

ACURA_TRIMS = [
    ("Type S", r"\btype[\s-]*s\b"),
    ("A-Spec", r"\ba[\s-]*spec\b"),
    ("Advance", r"\badvance\b"),
    ("Technology", r"\btechnology\b"),
    ("Base", r"\bbase\b"),
]

# ── Make → trims mapping ──
# Keys are lowercase for matching.
TRIMS_BY_MAKE: dict[str, list[tuple[str, str]]] = {
    "toyota": TOYOTA_TRIMS,
    "honda": HONDA_TRIMS,
    "ford": FORD_TRIMS,
    "chevrolet": CHEVROLET_TRIMS,
    "chevy": CHEVROLET_TRIMS,
    "hyundai": HYUNDAI_TRIMS,
    "kia": KIA_TRIMS,
    "nissan": NISSAN_TRIMS,
    "subaru": SUBARU_TRIMS,
    "bmw": BMW_TRIMS,
    "mercedes": MERCEDES_TRIMS,
    "mercedes-benz": MERCEDES_TRIMS,
    "audi": AUDI_TRIMS,
    "volkswagen": VOLKSWAGEN_TRIMS,
    "vw": VOLKSWAGEN_TRIMS,
    "mazda": MAZDA_TRIMS,
    "dodge": DODGE_TRIMS,
    "jeep": JEEP_TRIMS,
    "gmc": GMC_TRIMS,
    "ram": RAM_TRIMS,
    "tesla": TESLA_TRIMS,
    "lexus": LEXUS_TRIMS,
    "acura": ACURA_TRIMS,
}

# Fallback trims used when make isn't recognized
UNIVERSAL_TRIMS = [
    ("Limited", r"\blimited\b"),
    ("Platinum", r"\bplatinum\b"),
    ("Premium", r"\bpremium\b"),
    ("Touring", r"\btouring\b"),
    ("Sport", r"\bsport\b"),
    ("Hybrid", r"\bhybrid\b"),
    ("Base", r"\bbase\b"),
]


def detect_trim(title: str, make: Optional[str] = None) -> Optional[str]:
    """
    Detect trim from a listing title, using make-specific patterns.

    Args:
        title: The listing title, e.g. "2024 Toyota Camry SE Nightshade"
        make:  The car make, e.g. "Toyota". If None, falls back to universal list.

    Returns:
        The matched trim name, or None.
    """
    if not title:
        return None

    tl = title.lower()
    lookup = (make or "").lower().strip()
    candidates = TRIMS_BY_MAKE.get(lookup, UNIVERSAL_TRIMS)

    for trim_name, pattern in candidates:
        if re.search(pattern, tl):
            return trim_name

    return None