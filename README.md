# 🚗 Carma — Autonomous Car Buying Agent

Carma is a decision engine that matches users with the ideal car to buy. It reasons over lifestyle, commute patterns, budget, resale value, and scraped listing data to deliver explainable recommendations.

## Tech Stack

- **Frontend:** Next.js 15 (React) — `src/`
- **Backend Scraper:** Python + Tavily — `backend/`
- **Scoring Engine:** Attribute-based ranking from scraped listing data
- **Data Collection:** [Tavily](https://tavily.com) Search API
- **Database:** AWS DynamoDB _(coming soon)_

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

1. **Search** — Enter car type, budget, location, and intended use
2. **Aggregate** — Tavily searches Cars.com, CarGurus, AutoTrader, Craigslist and more
3. **Score Listings** — Carma scores each listing on value, condition, buy quality, and user match (1–10)
4. **Decide** — See ranked buy recommendations with transparent score explanations

## Contributing

1. Create a branch: `git checkout -b feature/your-feature`
2. Make changes and test locally with `npm run dev`
3. Push and open a PR
