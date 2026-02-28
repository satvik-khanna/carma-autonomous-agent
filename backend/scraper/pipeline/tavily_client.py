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
import re
from datetime import datetime
from pathlib import Path

import requests as _requests

try:
    from dotenv import load_dotenv
except ImportError:
    def load_dotenv(*_args, **_kwargs):
        return False

# Load .env.local from project root (3 levels up from pipeline/)
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
load_dotenv(_PROJECT_ROOT / ".env.local")
load_dotenv(_PROJECT_ROOT / ".env")

TAVILY_API_KEY = os.getenv("TAVILY_API_KEY")
if not TAVILY_API_KEY:
    raise RuntimeError("TAVILY_API_KEY is not set for the Craigslist pipeline.")
TAVILY_PROJECT = os.getenv("TAVILY_PROJECT")
TAVILY_BASE_URL = os.getenv("TAVILY_BASE_URL", "https://api.tavily.com").rstrip("/")


class TavilyHTTPClient:
    """Minimal Tavily client using requests (handles SSL certs via certifi)."""

    def __init__(self, api_key: str, base_url: str, project_id: str | None = None):
        self.api_key = api_key
        self.base_url = base_url
        self.session = _requests.Session()
        self.session.headers.update({
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        })
        if project_id:
            self.session.headers["X-Project-ID"] = project_id

    def extract(self, urls, **kwargs):
        payload = {"urls": urls}
        payload.update({k: v for k, v in kwargs.items() if v is not None})
        return self._post("/extract", payload)

    def _post(self, path: str, payload: dict) -> dict:
        api_timeout = payload.get("timeout")
        request_timeout = 30.0
        if isinstance(api_timeout, (int, float)) and api_timeout > 0:
            request_timeout = max(float(api_timeout) + 10.0, 30.0)

        resp = self.session.post(
            f"{self.base_url}{path}",
            json=payload,
            timeout=request_timeout,
        )

        if resp.status_code != 200:
            raise RuntimeError(
                f"Tavily request failed with HTTP {resp.status_code}: {resp.text[:500]}"
            )

        return resp.json()


client = TavilyHTTPClient(
    api_key=TAVILY_API_KEY,
    base_url=TAVILY_BASE_URL,
    project_id=TAVILY_PROJECT,
)

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


def query_slug(query: str | None = None) -> str:
    """Convert a car query into a filename-safe slug.

    'toyota camry' → 'toyota_camry'
    'BMW M3'       → 'bmw_m3'
    'ford f-150'   → 'ford_f-150'

    Falls back to CAR_QUERY env var if no query given.
    """
    q = query or os.environ.get("CAR_QUERY", "")
    slug = q.strip().lower()
    slug = re.sub(r"[^\w\s-]", "", slug)   # keep letters, digits, hyphens
    slug = re.sub(r"\s+", "_", slug)        # spaces → underscores
    return slug or "unknown"


def cache(data: dict, name: str, stage: int = 1) -> str:
    """Save data to the appropriate stage directory, return filepath."""
    d = stage_dir(stage)
    filepath = d / f"{name}_{datetime.now().strftime('%H%M%S')}.json"
    with open(filepath, "w") as f:
        json.dump(data, f, indent=2)
    print(f"💾 Cached to {filepath}")
    return str(filepath)
