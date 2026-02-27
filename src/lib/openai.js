import OpenAI from 'openai';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Rank car listings based on user preferences using GPT-4.
 * Returns scored and ranked listings with buy/rent recommendations.
 *
 * @param {Array} cars - Normalized car listings
 * @param {Object} preferences - User preferences
 * @returns {Promise<Array>} Ranked cars with scores and explanations
 */
export async function rankCars(cars, preferences) {
    if (!cars || cars.length === 0) {
        return [];
    }

    const prompt = buildRankingPrompt(cars, preferences);

    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                {
                    role: 'system',
                    content: `You are Carma, an expert automotive advisor. You analyze car listings and help users decide whether to buy or rent based on their preferences and financial situation. You always provide honest, data-driven recommendations.

You MUST respond with valid JSON only. No markdown, no code fences, just raw JSON.`,
                },
                {
                    role: 'user',
                    content: prompt,
                },
            ],
            temperature: 0.3,
            max_tokens: 4000,
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
            return applyFallbackScoring(cars, preferences);
        }

        // Parse the JSON response
        const parsed = JSON.parse(content);
        const rankings = parsed.rankings || parsed;

        // Merge rankings back with original car data
        return cars.map((car, index) => {
            const ranking = Array.isArray(rankings)
                ? rankings.find((r) => r.index === index) || rankings[index]
                : null;

            if (!ranking) {
                return { ...car, ...getDefaultScores() };
            }

            return {
                ...car,
                valueScore: clampScore(ranking.valueScore || ranking.value_score),
                buyScore: clampScore(ranking.buyScore || ranking.buy_score),
                rentScore: clampScore(ranking.rentScore || ranking.rent_score),
                matchScore: clampScore(ranking.matchScore || ranking.match_score),
                overallScore: clampScore(ranking.overallScore || ranking.overall_score),
                recommendation: ranking.recommendation || 'consider',
                aiExplanation: ranking.explanation || ranking.aiExplanation || '',
            };
        }).sort((a, b) => (b.overallScore || 0) - (a.overallScore || 0));

    } catch (error) {
        console.error('OpenAI ranking failed:', error);
        return applyFallbackScoring(cars, preferences);
    }
}

/**
 * Build the ranking prompt for GPT-4.
 */
function buildRankingPrompt(cars, preferences) {
    const carSummaries = cars.map((car, i) => {
        return `[${i}] ${car.title} | Price: ${car.price || 'N/A'} | Year: ${car.year || 'N/A'} | Mileage: ${car.mileage ? car.mileage.toLocaleString() + ' mi' : 'N/A'} | Source: ${car.source} | Description: ${car.description?.substring(0, 200) || 'N/A'}`;
    }).join('\n');

    return `Analyze these car listings for a user and rank them. Score each car from 1-10 on multiple dimensions.

## User Preferences
- Monthly Budget: $${preferences.budget || 'flexible'}
- Intended Use: ${preferences.useCase || 'daily commute'}
- Duration of Use: ${preferences.duration || '3+ years'}
- Location: ${preferences.location || 'not specified'}
- Preference: ${preferences.preference || 'open to both buy and rent'}

## Car Listings
${carSummaries}

## Required Output Format
Return a JSON object with a "rankings" array. Each item must have:
- "index": the car index number from above
- "valueScore": 1-10 (price vs market value)
- "buyScore": 1-10 (how good as a purchase — considers depreciation, resale, ownership cost)
- "rentScore": 1-10 (how good as a rental — considers monthly cost vs flexibility)
- "matchScore": 1-10 (how well it fits the user's needs)
- "overallScore": 1-10 (weighted composite)
- "recommendation": "buy" | "rent" | "consider" (what's best for THIS user)
- "explanation": brief 1-2 sentence explanation of the recommendation

Consider: depreciation, insurance costs, maintenance, fuel efficiency, resale value, rental market rates, and the user's specific situation.`;
}

/**
 * Clamp a score between 1 and 10.
 */
function clampScore(score) {
    if (!score || isNaN(score)) return 5;
    return Math.max(1, Math.min(10, Math.round(score)));
}

/**
 * Get default scores for a car when ranking fails.
 */
function getDefaultScores() {
    return {
        valueScore: 5,
        buyScore: 5,
        rentScore: 5,
        matchScore: 5,
        overallScore: 5,
        recommendation: 'consider',
        aiExplanation: 'Unable to generate AI analysis. Please review this listing manually.',
    };
}

/**
 * Apply basic fallback scoring when OpenAI is unavailable.
 */
function applyFallbackScoring(cars, preferences) {
    const budget = parseInt(preferences.budget) || 30000;

    return cars.map((car) => {
        let valueScore = 5;
        let buyScore = 5;
        let rentScore = 5;
        let matchScore = 5;

        // Price-based scoring
        if (car.priceNumeric) {
            if (car.priceNumeric <= budget * 0.7) valueScore = 8;
            else if (car.priceNumeric <= budget) valueScore = 6;
            else if (car.priceNumeric <= budget * 1.2) valueScore = 4;
            else valueScore = 2;
        }

        // Year-based scoring (newer = better for buy)
        if (car.year) {
            const age = new Date().getFullYear() - car.year;
            buyScore = age <= 2 ? 8 : age <= 5 ? 6 : age <= 8 ? 4 : 3;
            rentScore = age <= 3 ? 7 : age <= 6 ? 5 : 4;
        }

        // Mileage-based adjustment
        if (car.mileage) {
            if (car.mileage < 30000) { buyScore += 1; matchScore += 1; }
            else if (car.mileage > 100000) { buyScore -= 1; matchScore -= 1; }
        }

        const overallScore = Math.round((valueScore + buyScore + rentScore + matchScore) / 4);

        return {
            ...car,
            valueScore: clampScore(valueScore),
            buyScore: clampScore(buyScore),
            rentScore: clampScore(rentScore),
            matchScore: clampScore(matchScore),
            overallScore: clampScore(overallScore),
            recommendation: buyScore > rentScore ? 'buy' : rentScore > buyScore ? 'rent' : 'consider',
            aiExplanation: 'Scored using basic analysis. Connect to OpenAI for detailed recommendations.',
        };
    }).sort((a, b) => b.overallScore - a.overallScore);
}
