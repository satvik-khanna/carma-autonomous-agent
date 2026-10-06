# 🚗 Carma — Autonomous Car Buying Agent

Carma is a decision engine that matches users with the ideal car to buy. It reasons over lifestyle, commute patterns, budget, resale value, and scraped listing data to deliver explainable recommendations.

## Tech Stack

- **Frontend:** Next.js 15 (React) — `src/`
- **Backend Scraper:** Python + Tavily — `backend/`
- **Scoring Engine:** Attribute-based ranking from scraped listing data
- **Data Collection:** [Tavily](https://tavily.com) Search API
- **Storage:** none — every search scrapes Craigslist live into a temp dir that's deleted afterwards

## Getting Started

### 1. Clone the repo

```bash
git clone https://github.com/satvik-khanna/carma-autonomous-agent.git
cd carma-autonomous-agent
```

### 2. Frontend Setup (Next.js)

```bash
npm install
cp .env.local.example .env.local
# Add your API keys to .env.local
npm run dev
```

Open **http://localhost:3000** in your browser.

### 3. Backend Scraper Setup (Python)

```bash
pip install -r requirements.txt
# Run the scraping pipeline
python backend/scraper/pipeline/run_pipeline.py
```

## Environment Variables

Copy `.env.local.example` to `.env.local` and fill in:

| Key | Where to get it | Required? |
|---|---|---|
| `TAVILY_API_KEY` | [tavily.com](https://tavily.com) | ✅ Yes |
| `OPENAI_API_KEY` | [platform.openai.com](https://platform.openai.com) | Optional |

## Project Structure

```
├── src/                        # Next.js Frontend
│   ├── app/                    # Pages & API routes
│   ├── components/             # React components
│   ├── lib/                    # Tavily search + scoring engine
│   └── styles/                 # CSS design system
├── backend/                    # Python Scraper
│   ├── scraper/pipeline/       # Tavily-based scraping stages
│   └── data/                   # Scraped car data
├── .env.local.example          # Env template
├── package.json                # Node.js deps
└── requirements.txt            # Python deps
```

## How It Works

1. **Search** — Enter the car, budget, location, and intended use
2. **Scrape** — `POST /api/search` runs the Python pipeline (stages 1–5) against current Craigslist listings; the browser polls `GET /api/search?job=<id>` until it's done (about a minute)
3. **Score Listings** — Carma filters junk, dedupes, and scores each listing on value, condition, buy quality, and fit (1–10)
4. **Decide** — See ranked listings with the reasoning behind each score and a link to the live ad

## Contributing

1. Create a branch: `git checkout -b feature/your-feature`
2. Make changes and test locally with `npm run dev`
3. Push and open a PR
