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
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
try:
    from dotenv import load_dotenv
except ImportError:  # python-dotenv is optional when env vars are already present
    def load_dotenv(*_args, **_kwargs):
        return False

load_dotenv()

TAVILY_API_KEY = os.getenv("TAVILY_API_KEY")
if not TAVILY_API_KEY:
    raise RuntimeError("TAVILY_API_KEY is not set for the Craigslist pipeline.")
TAVILY_PROJECT = os.getenv("TAVILY_PROJECT")
TAVILY_BASE_URL = os.getenv("TAVILY_BASE_URL", "https://api.tavily.com").rstrip("/")


class TavilyHTTPClient:
    """Minimal Tavily client using the documented HTTP API.

    This keeps the scraper working even when the optional Tavily Python SDK
    is not installed in the local environment.
    """

    def __init__(self, api_key: str, base_url: str, project_id: str | None = None):
        self.api_key = api_key
        self.base_url = base_url
        self.project_id = project_id

    def extract(self, urls, **kwargs):
        payload = {"urls": urls}
        payload.update({k: v for k, v in kwargs.items() if v is not None})
        return self._post("/extract", payload)

    def _post(self, path: str, payload: dict) -> dict:
        data = json.dumps(payload).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
        }
        if self.project_id:
            headers["X-Project-ID"] = self.project_id

        request = Request(
            f"{self.base_url}{path}",
            data=data,
            headers=headers,
            method="POST",
        )

        api_timeout = payload.get("timeout")
        request_timeout = None
        if isinstance(api_timeout, (int, float)) and api_timeout > 0:
            request_timeout = max(float(api_timeout) + 10.0, 30.0)

        try:
            with urlopen(request, timeout=request_timeout) as response:
                raw = response.read().decode("utf-8")
        except HTTPError as exc:
            error_body = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(
                f"Tavily extract request failed with HTTP {exc.code}: {error_body or exc.reason}"
            ) from exc
        except URLError as exc:
            raise RuntimeError(f"Tavily extract request failed: {exc.reason}") from exc

        try:
            return json.loads(raw)
        except json.JSONDecodeError as exc:
            raise RuntimeError("Tavily extract returned a non-JSON response.") from exc


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
