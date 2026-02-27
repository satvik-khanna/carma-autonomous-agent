import { sortCarsByScoreDesc } from './scoringSort';

const DEFAULT_TOTAL_BUDGET = 30000;
const MONTHLY_BUDGET_THRESHOLD = 4000;
const MONTHLY_TO_TOTAL_MULTIPLIER = 55;

/**
 * Rank car listings using deterministic attribute-based scoring.
 * Scores are generated from scraped listing attributes and user preferences.
 */
export async function rankCars(cars, preferences = {}) {
    if (!Array.isArray(cars) || cars.length === 0) {
        return [];
    }

    // Skip OpenAI if no valid key (avoid noisy 401 errors)
    const apiKey = process.env.OPENAI_API_KEY || '';
    const hasValidKey = apiKey && !apiKey.includes('your_') && !apiKey.includes('_here') && apiKey.length > 20;

    if (!hasValidKey) {
        console.log('ℹ️  No OpenAI key — using Carma scoring engine');
        return applyFallbackScoring(cars, preferences);
    }

    const prompt = buildRankingPrompt(cars, preferences);

function scoreCar(car, preferences) {
    const budget = normalizeBudgetContext(preferences.budget);
    const year = normalizeNumber(car.year);
    const age = year ? Math.max(0, new Date().getFullYear() - year) : null;
    const mileage = normalizeNumber(car.mileage);
    const priceNumeric = normalizeNumber(car.priceNumeric);
    const attributes = mergeAttributes(car, age, mileage);

    const positives = [];
    const concerns = [];

    let valueScore = 5;
    if (priceNumeric && budget.totalBudget) {
        const budgetRatio = priceNumeric / budget.totalBudget;
        if (budgetRatio <= 0.75) {
            valueScore += 3;
            addReason(positives, 'well under budget');
        } else if (budgetRatio <= 0.9) {
            valueScore += 2;
            addReason(positives, 'comfortably within budget');
        } else if (budgetRatio <= 1.0) {
            valueScore += 1;
            addReason(positives, 'within budget target');
        } else if (budgetRatio <= 1.1) {
            valueScore += 0;
            addReason(concerns, 'near the top of budget');
        } else if (budgetRatio <= 1.25) {
            valueScore -= 2;
            addReason(concerns, 'above budget target');
        } else {
            valueScore -= 3;
            addReason(concerns, 'significantly above budget');
        }
    } else {
        valueScore -= 1;
        addReason(concerns, 'asking price not clearly available');
    }

/**
 * Build the ranking prompt for GPT-4.
 */
function buildRankingPrompt(cars, preferences) {
    const carSummaries = cars.map((car, i) => {
        const parts = [
            `[${i}] ${car.title}`,
            `Price: ${car.price || 'N/A'}`,
            `Year: ${car.year || 'N/A'}`,
            `Mileage: ${car.mileage ? car.mileage.toLocaleString() + ' mi' : 'N/A'}`,
            `Source: ${car.source}`,
            car.transmission ? `Trans: ${car.transmission}` : null,
            car.fuel ? `Fuel: ${car.fuel}` : null,
            car.location ? `Location: ${car.location}` : null,
            car.condition ? `Condition: ${car.condition}` : null,
            `Description: ${car.description?.substring(0, 200) || 'N/A'}`,
        ].filter(Boolean);
        return parts.join(' | ');
    }).join('\n');

    if (attributes.estimatedMonthlyPayment && budget.monthlyBudget) {
        const paymentRatio = attributes.estimatedMonthlyPayment / budget.monthlyBudget;
        if (paymentRatio <= 0.7) valueScore += 1;
        if (paymentRatio > 1.0) {
            valueScore -= 1;
            addReason(concerns, 'estimated monthly payment exceeds target');
        }
    }
    valueScore = clampScore(valueScore);

## User Preferences
- Monthly Budget: $${preferences.budget || 'flexible'}
- Intended Use: ${preferences.useCase || 'daily commute'}
- Duration of Use: ${preferences.duration || '3+ years'}
- Location: ${preferences.location || 'Bay Area, CA'}
- Preference: ${preferences.preference || 'open to both buy and rent'}

    switch (attributes.titleStatus) {
        case 'clean':
            conditionScore += 1;
            addReason(positives, 'clean title signal');
            break;
        case 'rebuilt':
            conditionScore -= 2;
            addReason(concerns, 'rebuilt title signal');
            break;
        case 'salvage':
            conditionScore -= 3;
            addReason(concerns, 'salvage title signal');
            break;
        default:
            break;
    }

## Required Output Format
Return a JSON object with a "rankings" array. Each item must have:
- "index": the car index number from above
- "valueScore": 1-10 (price vs market value)
- "buyScore": 1-10 (how good as a purchase — considers depreciation, resale, ownership cost, estimated maintenance)
- "rentScore": 1-10 (how good as a rental — considers monthly cost vs flexibility)
- "matchScore": 1-10 (how well it fits the user's needs, including whether it's worth the drive to the listing)
- "overallScore": 1-10 (weighted composite)
- "recommendation": "buy" | "rent" | "consider" (what's best for THIS user)
- "explanation": brief 1-2 sentence explanation including estimated annual maintenance cost and whether the listing location is convenient

Consider these factors carefully:
1. **Maintenance costs**: Luxury brands (BMW, Mercedes, Audi) cost $1,500-2,500/yr. Japanese cars (Toyota, Honda) cost $400-700/yr. Factor this into total ownership cost.
2. **Mileage risk zones**: Under 60K = low risk, 60-100K = moderate (timing belt, brakes due), 100K-150K = high risk (major repairs likely), 150K+ = very high risk.
3. **Distance/convenience**: If the listing is far from the user's location, factor in whether the deal is good enough to justify the drive. Closer listings get a matchScore boost.
4. **Depreciation**: New cars lose ~20% in year 1, then ~15%/yr for 4 years. Factor this into buy vs rent decision.
5. **Fuel costs**: Gas vs hybrid vs electric significantly impacts total ownership cost.`;
}

    if (attributes.serviceRecordCount !== null) {
        if (attributes.serviceRecordCount >= 5) {
            conditionScore += 1;
            addReason(positives, 'strong service record history');
        } else if (attributes.serviceRecordCount >= 1) {
            addReason(positives, 'service records available');
        }
    } else if (attributes.serviceRecords) {
        conditionScore += 1;
        addReason(positives, 'service history mention');
    } else {
        addReason(concerns, 'service history not clearly documented');
    }

    if (attributes.mileagePerYear !== null) {
        if (attributes.mileagePerYear <= 12000) {
            conditionScore += 1;
            addReason(positives, 'mileage trend is healthy per year');
        } else if (attributes.mileagePerYear > 18000) {
            conditionScore -= 1;
            addReason(concerns, 'high mileage per year trend');
        }
    }
    conditionScore = clampScore(conditionScore);

    let buyScore = 5;
    if (age !== null) {
        if (age <= 3) {
            buyScore += 3;
            addReason(positives, 'newer model year for long-term ownership');
        } else if (age <= 6) {
            buyScore += 2;
        } else if (age <= 10) {
            buyScore += 0;
        } else if (age <= 14) {
            buyScore -= 1;
            addReason(concerns, 'older model year');
        } else {
            buyScore -= 2;
            addReason(concerns, 'high vehicle age');
        }
    } else {
        addReason(concerns, 'model year is unclear');
    }

    if (mileage !== null) {
        if (mileage <= 40000) {
            buyScore += 2;
            addReason(positives, 'low mileage');
        } else if (mileage <= 80000) {
            buyScore += 1;
            addReason(positives, 'reasonable mileage');
        } else if (mileage <= 120000) {
            buyScore += 0;
        } else if (mileage <= 160000) {
            buyScore -= 1;
            addReason(concerns, 'higher mileage');
        } else {
            buyScore -= 2;
            addReason(concerns, 'very high mileage');
        }
    } else {
        addReason(concerns, 'odometer detail missing');
    }

    if (attributes.priceToMarketRatio !== null) {
        if (attributes.priceToMarketRatio <= 0.95) buyScore += 1;
        if (attributes.priceToMarketRatio > 1.1) buyScore -= 1;
    }

    if (attributes.titleStatus === 'rebuilt') buyScore -= 1;
    if (attributes.titleStatus === 'salvage') buyScore -= 2;
    if (attributes.accidentSeverity === 'severe') buyScore -= 1;
    buyScore = clampScore(buyScore);

    let matchScore = 5;
    const useCase = `${preferences.useCase || ''}`.toLowerCase();
    const duration = `${preferences.duration || ''}`.toLowerCase();
    const text = `${car.title || ''} ${car.description || ''}`.toLowerCase();

    if (useCase.includes('commute')) {
        if (['hybrid', 'electric'].includes(attributes.fuelType)) matchScore += 2;
        if (['sedan', 'hatchback'].includes(attributes.bodyStyle)) matchScore += 1;
        if (attributes.bodyStyle === 'truck') {
            matchScore -= 1;
            addReason(concerns, 'body style may be less efficient for commute use');
        }
    }

    if (useCase.includes('family')) {
        if (['suv', 'minivan', 'sedan'].includes(attributes.bodyStyle)) matchScore += 2;
        if (attributes.bodyStyle === 'coupe') matchScore -= 1;
    }

    if (useCase.includes('road') || useCase.includes('weekend')) {
        if (['suv', 'wagon', 'minivan'].includes(attributes.bodyStyle)) matchScore += 1;
        if (['awd', 'four_wd'].includes(attributes.drivetrain)) matchScore += 1;
    }

    if (useCase.includes('business')) {
        if (year && year >= 2019) matchScore += 1;
        if (['excellent', 'good'].includes(attributes.condition)) matchScore += 1;
    }

    if (useCase.includes('fun') || useCase.includes('performance')) {
        if (/\b(sport|turbo|gt|performance|type r|amg|ss)\b/.test(text)) matchScore += 2;
        if (attributes.bodyStyle === 'coupe') matchScore += 1;
    }

    if (duration.includes('3+') || duration.includes('1-3')) {
        if (age !== null && age > 10) matchScore -= 1;
        if (mileage !== null && mileage > 130000) matchScore -= 1;
        if (attributes.serviceRecordCount && attributes.serviceRecordCount >= 3) matchScore += 1;
    }

    if (priceNumeric && budget.totalBudget) {
        const ratio = priceNumeric / budget.totalBudget;
        if (ratio <= 1.0) matchScore += 1;
        if (ratio > 1.2) matchScore -= 1;
    }
    matchScore = clampScore(matchScore);

    let confidenceScore = 4;
    if (attributes.listingCompleteness !== null) {
        confidenceScore += (attributes.listingCompleteness - 50) / 20;
    }
    if (priceNumeric) confidenceScore += 1;
    if (year) confidenceScore += 0.5;
    if (mileage !== null) confidenceScore += 0.5;
    if (attributes.ownerCount !== null) confidenceScore += 0.5;
    if (attributes.serviceRecordCount !== null) confidenceScore += 0.5;
    if (attributes.titleStatus !== 'unknown') confidenceScore += 0.5;
    if (attributes.condition !== 'unknown') confidenceScore += 0.5;
    confidenceScore = clampScore(confidenceScore);

    if (confidenceScore >= 8) {
        addReason(positives, 'listing has rich detail for scoring confidence');
    } else if (confidenceScore <= 5) {
        addReason(concerns, 'limited listing detail reduces score certainty');
    }

    const overallScore = clampScore(
        Math.round(
            (valueScore * 0.24) +
            (conditionScore * 0.23) +
            (buyScore * 0.25) +
            (matchScore * 0.18) +
            (confidenceScore * 0.10)
        )
    );

    const recommendation = overallScore >= 7 && buyScore >= 7 && conditionScore >= 6
        ? 'buy'
        : 'consider';

    return {
        ...car,
        valueScore,
        conditionScore,
        buyScore,
        matchScore,
        confidenceScore,
        overallScore,
        recommendation,
        scoreBreakdown: {
            budgetFit: describeBudgetFit(priceNumeric, budget.totalBudget),
            marketPosition: describeMarketPosition(attributes.priceToMarketRatio),
            titleStatus: attributes.titleStatus,
            accidentSeverity: attributes.accidentSeverity,
            ownerCount: attributes.ownerCount,
            serviceRecordCount: attributes.serviceRecordCount,
            mileagePerYear: attributes.mileagePerYear,
            listingCompleteness: attributes.listingCompleteness,
        },
        aiExplanation: buildScoreExplanation({
            overallScore,
            valueScore,
            conditionScore,
            buyScore,
            matchScore,
            confidenceScore,
            positives,
            concerns,
        }),
    };
}

// ═══════════════════════════════════════════════════════════════
//  Enhanced Fallback Scoring Engine
// ═══════════════════════════════════════════════════════════════

/**
 * Estimated annual maintenance cost by brand tier.
 */
const MAINTENANCE_COSTS = {
    // Economy / Reliable — $400-700/yr
    toyota: { annual: 500, tier: 'economy', label: '~$500/yr maintenance' },
    honda: { annual: 550, tier: 'economy', label: '~$550/yr maintenance' },
    mazda: { annual: 550, tier: 'economy', label: '~$550/yr maintenance' },
    subaru: { annual: 600, tier: 'economy', label: '~$600/yr maintenance' },
    hyundai: { annual: 500, tier: 'economy', label: '~$500/yr maintenance' },
    kia: { annual: 500, tier: 'economy', label: '~$500/yr maintenance' },
    nissan: { annual: 600, tier: 'economy', label: '~$600/yr maintenance' },
    // Mid-tier — $700-1,200/yr
    ford: { annual: 800, tier: 'mid', label: '~$800/yr maintenance' },
    chevrolet: { annual: 800, tier: 'mid', label: '~$800/yr maintenance' },
    dodge: { annual: 900, tier: 'mid', label: '~$900/yr maintenance' },
    gmc: { annual: 850, tier: 'mid', label: '~$850/yr maintenance' },
    jeep: { annual: 950, tier: 'mid', label: '~$950/yr maintenance' },
    volkswagen: { annual: 900, tier: 'mid', label: '~$900/yr maintenance' },
    volvo: { annual: 1000, tier: 'mid', label: '~$1,000/yr maintenance' },
    // Luxury — $1,200-2,500/yr
    bmw: { annual: 1800, tier: 'luxury', label: '~$1,800/yr maintenance' },
    mercedes: { annual: 1900, tier: 'luxury', label: '~$1,900/yr maintenance' },
    'mercedes-benz': { annual: 1900, tier: 'luxury', label: '~$1,900/yr maintenance' },
    audi: { annual: 1700, tier: 'luxury', label: '~$1,700/yr maintenance' },
    lexus: { annual: 700, tier: 'premium-reliable', label: '~$700/yr maintenance' },
    acura: { annual: 700, tier: 'premium-reliable', label: '~$700/yr maintenance' },
    infiniti: { annual: 900, tier: 'premium', label: '~$900/yr maintenance' },
    cadillac: { annual: 1200, tier: 'luxury', label: '~$1,200/yr maintenance' },
    lincoln: { annual: 1100, tier: 'luxury', label: '~$1,100/yr maintenance' },
    porsche: { annual: 2200, tier: 'luxury', label: '~$2,200/yr maintenance' },
    'land rover': { annual: 2000, tier: 'luxury', label: '~$2,000/yr maintenance' },
    jaguar: { annual: 1800, tier: 'luxury', label: '~$1,800/yr maintenance' },
    tesla: { annual: 400, tier: 'ev', label: '~$400/yr maintenance (EV)' },
};

/**
 * Bay Area reference coordinates (approximate center — San Jose).
 */
const BAY_AREA_LOCATIONS = {
    'san francisco': { lat: 37.7749, lng: -122.4194 },
    'san jose': { lat: 37.3382, lng: -121.8863 },
    'oakland': { lat: 37.8044, lng: -122.2712 },
    'berkeley': { lat: 37.8715, lng: -122.2730 },
    'palo alto': { lat: 37.4419, lng: -122.1430 },
    'santa cruz': { lat: 36.9741, lng: -122.0308 },
    'sacramento': { lat: 38.5816, lng: -121.4944 },
    'stockton': { lat: 37.9577, lng: -121.2908 },
    'modesto': { lat: 37.6391, lng: -120.9969 },
    'monterey': { lat: 36.6002, lng: -121.8947 },
    'fremont': { lat: 37.5485, lng: -121.9886 },
    'sunnyvale': { lat: 37.3688, lng: -122.0363 },
    'hayward': { lat: 37.6688, lng: -122.0808 },
    'concord': { lat: 37.9780, lng: -122.0311 },
    'vallejo': { lat: 38.1041, lng: -122.2566 },
    'santa rosa': { lat: 38.4404, lng: -122.7141 },
    'south bay': { lat: 37.3382, lng: -121.8863 },
    'east bay': { lat: 37.8044, lng: -122.2712 },
    'peninsula': { lat: 37.5585, lng: -122.2711 },
    'south sf': { lat: 37.6547, lng: -122.4077 },
    'redwood city': { lat: 37.4852, lng: -122.2364 },
};

const DEFAULT_USER_LOCATION = { lat: 37.3382, lng: -121.8863 }; // San Jose

/**
 * Calculate distance in miles between two lat/lng points (Haversine formula).
 */
function distanceMiles(lat1, lng1, lat2, lng2) {
    const R = 3959; // Earth radius in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Estimate distance to a listing based on its location string or coordinates.
 */
function estimateDistance(car, userLocation) {
    const user = userLocation || DEFAULT_USER_LOCATION;

    // If car has coordinates
    if (car.latitude && car.longitude) {
        return distanceMiles(user.lat, user.lng, car.latitude, car.longitude);
    }

    // Try to match location string
    const loc = (car.location || '').toLowerCase().trim();
    for (const [name, coords] of Object.entries(BAY_AREA_LOCATIONS)) {
        if (loc.includes(name)) {
            return distanceMiles(user.lat, user.lng, coords.lat, coords.lng);
        }
    }

    return null; // Unknown distance
}

/**
 * Get mileage risk assessment.
 */
function getMileageRisk(mileage) {
    if (!mileage) return { risk: 'unknown', penalty: 0, label: 'mileage unknown' };
    if (mileage < 30000) return { risk: 'low', penalty: 0, label: 'low mileage, minimal wear' };
    if (mileage < 60000) return { risk: 'low', penalty: 0, label: 'moderate mileage, good shape' };
    if (mileage < 100000) return { risk: 'moderate', penalty: -1, label: 'approaching major service interval (timing belt, brakes)' };
    if (mileage < 150000) return { risk: 'high', penalty: -2, label: 'high mileage — expect $1-3K in repairs soon' };
    return { risk: 'very-high', penalty: -3, label: 'very high mileage — significant repair risk' };
}

/**
 * Resolve user's typed location to coordinates.
 * Handles: "San Jose", "San Jose, CA", "san jose ca", "94043", etc.
 */
function resolveUserLocation(locationInput) {
    if (!locationInput) return DEFAULT_USER_LOCATION;
    const input = locationInput.toLowerCase().replace(/[,]/g, ' ').trim();

    // Try exact match first
    if (BAY_AREA_LOCATIONS[input]) return BAY_AREA_LOCATIONS[input];

    // Try partial match (e.g. "san jose ca" contains "san jose")
    for (const [name, coords] of Object.entries(BAY_AREA_LOCATIONS)) {
        if (input.includes(name) || name.includes(input)) {
            return coords;
        }
    }

    // Common ZIP code mapping
    const ZIP_CODES = {
        '94': { lat: 37.5585, lng: -122.2711 },  // SF/Peninsula area
        '95': { lat: 37.3382, lng: -121.8863 },   // San Jose area
        '94043': { lat: 37.3861, lng: -122.0839 }, // Mountain View
        '94301': { lat: 37.4419, lng: -122.1430 }, // Palo Alto
        '94102': { lat: 37.7812, lng: -122.4137 }, // SF downtown
        '94612': { lat: 37.8044, lng: -122.2712 }, // Oakland
        '95050': { lat: 37.3541, lng: -121.9552 }, // Santa Clara
        '95110': { lat: 37.3382, lng: -121.8863 }, // San Jose
        '95616': { lat: 38.5449, lng: -121.7405 }, // Davis
        '95814': { lat: 38.5816, lng: -121.4944 }, // Sacramento
    };

    // Try ZIP code match
    const zipMatch = input.match(/\d{5}/);
    if (zipMatch) {
        const zip = zipMatch[0];
        if (ZIP_CODES[zip]) return ZIP_CODES[zip];
        const prefix = zip.substring(0, 2);
        if (ZIP_CODES[prefix]) return ZIP_CODES[prefix];
    }

    return DEFAULT_USER_LOCATION; // Default to San Jose
}

/**
 * Apply enhanced fallback scoring with maintenance, mileage, and distance analysis.
 */
function applyFallbackScoring(cars, preferences) {
    const budget = parseInt(preferences.budget) || 30000;
    const userLocation = resolveUserLocation(preferences.location);

    return cars.map((car) => {
        let valueScore = 5;
        let buyScore = 5;
        let rentScore = 5;
        let matchScore = 5;
        const insights = []; // Build explanation

        // ── 1. Price vs Budget ──
        if (car.priceNumeric) {
            const ratio = car.priceNumeric / budget;
            if (ratio <= 0.5) { valueScore = 9; insights.push('excellent value — well under budget'); }
            else if (ratio <= 0.7) { valueScore = 8; insights.push('great price point'); }
            else if (ratio <= 1.0) { valueScore = 6; insights.push('within budget'); }
            else if (ratio <= 1.2) { valueScore = 4; insights.push('slightly over budget'); }
            else { valueScore = 2; insights.push('significantly over budget'); }
        }

        // ── 2. Maintenance Cost by Brand ──
        const make = (car.make || car.title?.split(' ')[1] || '').toLowerCase();
        const maintenance = MAINTENANCE_COSTS[make] || { annual: 750, tier: 'mid', label: '~$750/yr maintenance' };

        if (maintenance.tier === 'economy' || maintenance.tier === 'premium-reliable' || maintenance.tier === 'ev') {
            buyScore += 2;
            insights.push(maintenance.label + ' (low)');
        } else if (maintenance.tier === 'luxury') {
            buyScore -= 2;
            rentScore += 1; // Luxury = better to rent (avoids maintenance)
            insights.push(maintenance.label + ' (expensive!)');
        } else {
            insights.push(maintenance.label);
        }

        // Total 5-year ownership cost estimate
        if (car.priceNumeric) {
            const fiveYearCost = car.priceNumeric + (maintenance.annual * 5);
            const monthlyOwnership = Math.round(fiveYearCost / 60);
            insights.push(`~$${monthlyOwnership}/mo total ownership cost`);
        }

        // ── 3. Year / Age ──
        if (car.year) {
            const age = new Date().getFullYear() - car.year;
            if (age <= 2) { buyScore += 2; rentScore += 1; }
            else if (age <= 5) { buyScore += 1; }
            else if (age >= 10) { buyScore -= 1; rentScore -= 1; }
            if (age >= 15) { buyScore -= 1; }
        }

        // ── 4. Mileage Wear Analysis ──
        const mileageRisk = getMileageRisk(car.mileage);
        buyScore += mileageRisk.penalty;
        if (mileageRisk.risk === 'high' || mileageRisk.risk === 'very-high') {
            rentScore += 1; // High mileage = better to rent
        }
        insights.push(mileageRisk.label);

        // Price per mile (value metric)
        if (car.priceNumeric && car.mileage) {
            const pricePerMile = car.priceNumeric / car.mileage;
            if (pricePerMile < 0.10) { valueScore += 1; }
            else if (pricePerMile > 0.30) { valueScore -= 1; }
        }

        // ── 5. Distance / Worth the Drive ──
        const distance = estimateDistance(car, userLocation);
        if (distance !== null) {
            if (distance <= 10) {
                matchScore += 2;
                insights.push(`📍 ${Math.round(distance)} mi away — very convenient`);
            } else if (distance <= 30) {
                matchScore += 1;
                insights.push(`📍 ${Math.round(distance)} mi away — reasonable drive`);
            } else if (distance <= 60) {
                // Only worth it if the deal is great
                if (valueScore >= 7) {
                    matchScore += 0;
                    insights.push(`📍 ${Math.round(distance)} mi away — worth the drive for this deal`);
                } else {
                    matchScore -= 1;
                    insights.push(`📍 ${Math.round(distance)} mi away — long drive, average deal`);
                }
            } else {
                matchScore -= 2;
                insights.push(`📍 ${Math.round(distance)} mi away — very far, only worth it for a steal`);
            }
        } else if (car.location) {
            insights.push(`📍 ${car.location}`);
        }

        // ── 6. Fuel Efficiency ──
        const fuel = (car.fuel || '').toLowerCase();
        if (fuel.includes('electric') || fuel.includes('ev')) {
            buyScore += 1; matchScore += 1;
            insights.push('⚡ electric — zero fuel costs');
        } else if (fuel.includes('hybrid')) {
            buyScore += 1;
            insights.push('🔋 hybrid — low fuel costs');
        } else if (fuel.includes('diesel')) {
            insights.push('⛽ diesel — good highway mpg');
        }

        // ── 7. Duration preference ──
        if (preferences.duration) {
            if (preferences.duration.includes('3+') || preferences.duration.includes('long')) {
                buyScore += 1;
                if (maintenance.tier === 'economy') buyScore += 1; // Reliable + long term = great buy
            } else if (preferences.duration.includes('less') || preferences.duration.includes('short')) {
                rentScore += 2;
            }
        }

        // ── 8. Stage 5 Research Data (if available) ──
        const research = car.research;
        if (research) {
            // Reliability from real research
            const relScore = research.reliability?.reliability_score;
            // Reddit: Should I buy?
            const sib = research.should_i_buy;
            if (sib) {
                const v = sib.reddit_verdict;
                if (v === 'strong_buy' || v === 'buy') { buyScore += 2; insights.push('📱 Reddit says: BUY'); }
                else if (v === 'avoid' || v === 'caution') { buyScore -= 2; insights.push('📱 Reddit says: CAUTION'); }
                // Add top advice snippet
                if (sib.advice?.length > 0) {
                    insights.push(`💬 "${sib.advice[0].substring(0, 80)}..."`);
                }
            }

            // Reddit: Mechanic advice
            const mech = research.mechanic_advice;
            if (mech) {
                const relScore = mech.reliability_score;
                if (relScore >= 7) { buyScore += 2; insights.push('🔧 Mechanics say: reliable'); }
                else if (relScore <= 4) { buyScore -= 2; insights.push('🔧 Mechanics say: reliability concerns'); }
                const issues = mech.known_issues;
                if (issues?.length > 0) {
                    insights.push(`⚙️ Watch for: ${issues.slice(0, 2).join(', ')}`);
                }
            }

            // Reddit: Owner satisfaction
            const own = research.ownership_experience;
            if (own) {
                if (own.owner_satisfaction === 'very_satisfied' || own.owner_satisfaction === 'satisfied') {
                    matchScore += 1; insights.push('👥 Owners are happy');
                } else if (own.owner_satisfaction === 'dissatisfied') {
                    matchScore -= 1; insights.push('👥 Some owners dissatisfied');
                }
            }

            // Reddit: Cost & value analysis
            const costs = research.costs_and_value;
            if (costs) {
                const pv = costs.price_verdict;
                if (pv === 'below_market') { valueScore += 2; insights.push('💰 Below market — great deal'); }
                else if (pv === 'overpriced') { valueScore -= 2; insights.push('📈 Possibly overpriced — negotiate'); }
                else if (pv === 'fair') { insights.push('✅ Fair market price'); }
            }

            // Reddit: High mileage warning
            if (research.high_mileage) {
                const hm = research.high_mileage;
                if (hm.high_mileage_verdict === 'proceed_with_caution') {
                    buyScore -= 1; insights.push('⚠️ High mileage — get inspected');
                }
            }

            // Use Reddit verdict as primary explanation
            if (research.verdict) {
                insights.unshift(research.verdict.split('.')[0]);
            }

            // Old format compatibility (from previous Stage 5 runs)
            if (!sib && research.reliability) {
                const relScore = research.reliability?.reliability_score;
                if (relScore >= 7) { buyScore += 2; }
                else if (relScore <= 4) { buyScore -= 2; }
            }
        }

        // ── Compute final scores (buy-focused) ──
        const overallScore = Math.round(
            (valueScore * 0.35) + (buyScore * 0.35) + (matchScore * 0.3)
        );

        const recommendation = overallScore >= 7 ? 'buy' : 'consider';

        // Build a human-readable explanation
        const topInsights = insights.slice(0, 3).join('. ');
        const aiExplanation = topInsights + '.';

        return {
            ...car,
            valueScore: clampScore(valueScore),
            buyScore: clampScore(buyScore),
            matchScore: clampScore(matchScore),
            overallScore: clampScore(overallScore),
            recommendation,
            aiExplanation,
            estimatedMaintenanceCost: maintenance.annual,
            distanceMiles: distance ? Math.round(distance) : null,
        };
    }).sort((a, b) => b.overallScore - a.overallScore);
}

