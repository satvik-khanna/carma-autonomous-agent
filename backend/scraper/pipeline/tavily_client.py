"""
Shared Tavily client and path helpers. Import this, don't run it.

Data directory layout (relative to backend/):
  data/craigslist/01_raw_extracts/
  data/craigslist/02_links/
  data/craigslist/03_listing_pages/
  data/craigslist/04_structured/
"""

import os
import json
from datetime import datetime
from pathlib import Path
from dotenv import load_dotenv
from tavily import TavilyClient

load_dotenv()
client = TavilyClient(api_key=os.getenv("TAVILY_API_KEY"))

# ── Resolve data root: backend/data/craigslist/ ──
# pipeline/ lives at backend/scraper/pipeline/
# so go up 2 levels to backend/, then into data/craigslist/
PIPELINE_DIR = Path(__file__).resolve().parent
DATA_ROOT = (PIPELINE_DIR / ".." / ".." / "data" / "craigslist").resolve()

# Stage directories — each stage reads from previous, writes to its own
STAGE_DIRS = {
    1: DATA_ROOT / "01_raw_extracts",
    2: DATA_ROOT / "02_links",
    3: DATA_ROOT / "03_listing_pages",
    4: DATA_ROOT / "04_structured",
}


def stage_dir(stage: int) -> Path:
    """Get and create the output directory for a pipeline stage."""
    d = STAGE_DIRS[stage]
    d.mkdir(parents=True, exist_ok=True)
    return d


def cache(data: dict, name: str, stage: int = 1) -> str:
    """Save data to the appropriate stage directory, return filepath."""
    d = stage_dir(stage)
    filepath = d / f"{name}_{datetime.now().strftime('%H%M%S')}.json"
    with open(filepath, "w") as f:
        json.dump(data, f, indent=2)
    print(f"💾 Cached to {filepath}")
    return str(filepath)