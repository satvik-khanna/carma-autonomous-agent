# 🚗 Carma — Autonomous Car Buy & Rent Agent

Carma is an AI-powered decision engine that matches users with the ideal car for buying or renting. It reasons over lifestyle, commute patterns, budget, resale value, and real-time market data to deliver explainable, personalized recommendations.

## Tech Stack

- **Frontend:** Next.js 15 (React) — `src/`
- **Backend Scraper:** Python + Tavily — `backend/`
- **AI Ranking:** OpenAI GPT-4o
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
| `OPENAI_API_KEY` | [platform.openai.com](https://platform.openai.com) | Optional (fallback scoring works without it) |

## Project Structure

```
├── src/                        # Next.js Frontend
│   ├── app/                    # Pages & API routes
│   ├── components/             # React components
│   ├── lib/                    # Tavily & OpenAI clients
│   └── styles/                 # CSS design system
├── backend/                    # Python Scraper
│   ├── scraper/pipeline/       # Tavily-based scraping stages
│   └── data/                   # Scraped car data
├── .env.local.example          # Env template
├── package.json                # Node.js deps
└── requirements.txt            # Python deps
```

## How It Works

1. **Search** — Enter car type, budget, location, and preferences
2. **Aggregate** — Tavily searches Cars.com, CarGurus, AutoTrader, Craigslist and more
3. **AI Rank** — OpenAI scores each car on value, buy suitability, rent suitability, and user match (1–10)
4. **Decide** — See ranked results with buy vs rent recommendations and AI explanations

## Contributing

1. Create a branch: `git checkout -b feature/your-feature`
2. Make changes and test locally with `npm run dev`
3. Push and open a PR
