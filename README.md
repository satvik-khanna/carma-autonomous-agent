# 🚗 Carma — Smart Car Buy & Rent Recommendations

Carma aggregates car listings from top sites and uses AI to help you decide whether to **buy or rent** — personalized to your budget and lifestyle.

## Tech Stack

- **Frontend:** Next.js 15 (React)
- **Data Collection:** [Tavily](https://tavily.com) Search API
- **AI Ranking:** OpenAI GPT-4o
- **Database:** AWS DynamoDB _(coming soon)_

## Getting Started

### 1. Clone the repo

```bash
git clone https://github.com/YOUR_USERNAME/carma.git
cd carma
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up environment variables

Copy the example env file and add your API keys:

```bash
cp .env.local.example .env.local
```

Then edit `.env.local`:

```
TAVILY_API_KEY=tvly-your-key-here
OPENAI_API_KEY=sk-your-key-here
```

> **Note:** The app requires at least the **Tavily API key** to search for cars. Without an OpenAI key, it will use basic fallback scoring instead of AI-powered rankings.

### 4. Run the dev server

```bash
npm run dev
```

Open **http://localhost:3000** in your browser.

## Project Structure

```
src/
├── app/
│   ├── layout.js              # Root layout, navbar, footer
│   ├── page.js                # Landing page with search form
│   ├── results/page.js        # Ranked results with filters
│   └── api/
│       ├── search/route.js    # POST /api/search — Tavily search
│       └── rank/route.js      # POST /api/rank — OpenAI ranking
├── components/
│   ├── CarCard.js             # Car listing card with scores
│   ├── SearchForm.js          # Search + preferences form
│   ├── ScoreBar.js            # Score visualization bar
│   └── RankingBadge.js        # Buy/Rent/Consider badge
├── lib/
│   ├── tavily.js              # Tavily API client
│   └── openai.js              # OpenAI ranking engine
└── styles/
    └── globals.css            # Design system (dark mode)
```

## How It Works

1. **Search** — Enter car type, budget, location, and preferences
2. **Aggregate** — Tavily searches Cars.com, CarGurus, AutoTrader, CARFAX, TrueCar, Edmunds
3. **AI Rank** — OpenAI scores each car on value, buy suitability, rent suitability, and user match (1–10)
4. **Decide** — See ranked results with buy vs rent recommendations and AI explanations

## API Keys

| Key | Where to get it | Required? |
|---|---|---|
| `TAVILY_API_KEY` | [tavily.com](https://tavily.com) | ✅ Yes |
| `OPENAI_API_KEY` | [platform.openai.com](https://platform.openai.com) | Optional (fallback scoring works without it) |

## Contributing

1. Create a branch: `git checkout -b feature/your-feature`
2. Make changes and test locally with `npm run dev`
3. Push and open a PR
