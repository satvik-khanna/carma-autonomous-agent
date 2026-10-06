"""Match listing titles against a car query like "ford f-150" or "tesla model 3"."""

from __future__ import annotations

import re
from typing import Optional

MAKES = {
    "acura", "audi", "bmw", "buick", "cadillac", "chevrolet", "chevy", "chrysler",
    "dodge", "fiat", "ford", "genesis", "gmc", "honda", "hyundai", "infiniti",
    "jaguar", "jeep", "kia", "land", "rover", "lexus", "lincoln", "mazda",
    "mercedes", "mercedes-benz", "mini", "mitsubishi", "nissan", "porsche", "ram",
    "subaru", "tesla", "toyota", "volkswagen", "vw", "volvo",
}


def split_query(query: str) -> tuple[Optional[str], str]:
    """'tesla model 3' -> ('tesla', 'model 3'); 'supra' -> (None, 'supra')."""
    words = query.lower().split()
    if words and words[0] in MAKES:
        return words[0], " ".join(words[1:])
    return None, " ".join(words)


def phrase_pattern(phrase: str) -> Optional[re.Pattern]:
    """Whole-word pattern where spaces/hyphens between letter and digit runs are optional,
    so "f-150" matches F150 / F 150 / F-150 and "m3" doesn't match "m340i".
    A trailing number may carry one trim letter ("q50" matches "Q50S")."""
    runs = re.findall(r"[a-z]+|\d+", phrase.lower())
    if not runs:
        return None
    body = r"[\s-]?".join(map(re.escape, runs))
    suffix = r"[a-z]?" if runs[-1].isdigit() else ""
    return re.compile(r"\b" + body + suffix + r"\b", re.IGNORECASE)


def title_matches_query(title: Optional[str], query: str) -> bool:
    """The title must contain the model; the make may be omitted
    (sellers often write "Supra turbo 1987" without "Toyota")."""
    if not title:
        return False
    make, model = split_query(query)
    pattern = phrase_pattern(model or make or "")
    return bool(pattern and pattern.search(title))
