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

    const scored = cars.map((car) => scoreCar(car, preferences));
    return sortCarsByScoreDesc(scored);
}

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

    if (attributes.priceToMarketRatio !== null) {
        if (attributes.priceToMarketRatio <= 0.92) {
            valueScore += 2;
            addReason(positives, 'priced below market reference');
        } else if (attributes.priceToMarketRatio <= 1.0) {
            valueScore += 1;
            addReason(positives, 'market-aligned pricing');
        } else if (attributes.priceToMarketRatio <= 1.08) {
            valueScore -= 1;
            addReason(concerns, 'slightly above market reference');
        } else {
            valueScore -= 2;
            addReason(concerns, 'priced materially above market reference');
        }
    }

    if (attributes.estimatedMonthlyPayment && budget.monthlyBudget) {
        const paymentRatio = attributes.estimatedMonthlyPayment / budget.monthlyBudget;
        if (paymentRatio <= 0.7) valueScore += 1;
        if (paymentRatio > 1.0) {
            valueScore -= 1;
            addReason(concerns, 'estimated monthly payment exceeds target');
        }
    }
    valueScore = clampScore(valueScore);

    let conditionScore = 5;
    switch (attributes.condition) {
        case 'excellent':
            conditionScore += 2;
            addReason(positives, 'excellent condition wording');
            break;
        case 'good':
            conditionScore += 1;
            addReason(positives, 'good condition wording');
            break;
        case 'fair':
            conditionScore -= 1;
            addReason(concerns, 'fair condition wording');
            break;
        case 'poor':
            conditionScore -= 2;
            addReason(concerns, 'needs-work language detected');
            break;
        default:
            break;
    }

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

    switch (attributes.accidentSeverity) {
        case 'none':
            conditionScore += 1;
            addReason(positives, 'no-accident signal');
            break;
        case 'minor':
            conditionScore -= 1;
            addReason(concerns, 'minor damage history mention');
            break;
        case 'moderate':
            conditionScore -= 2;
            addReason(concerns, 'accident history mention');
            break;
        case 'severe':
            conditionScore -= 3;
            addReason(concerns, 'major damage keywords detected');
            break;
        default:
            break;
    }

    if (attributes.ownerCount === 1) {
        conditionScore += 1;
        addReason(positives, 'one-owner signal');
    } else if (attributes.ownerCount && attributes.ownerCount >= 3) {
        conditionScore -= 1;
        addReason(concerns, 'multiple-owner history');
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

function mergeAttributes(car, age, mileage) {
    const derived = deriveAttributesFromText(`${car.title || ''} ${car.description || ''}`, car);
    const raw = { ...derived, ...(car.attributes || {}) };
    const carPrice = normalizeNumber(car.priceNumeric);

    const ownerCount = normalizeCount(raw.ownerCount ?? raw.owners);
    const inferredOneOwner = ownerCount === 1 || Boolean(raw.oneOwner);
    const normalizedOwnerCount = ownerCount ?? (inferredOneOwner ? 1 : null);
    const serviceRecordCount = normalizeCount(raw.serviceRecordCount);
    const listedMarketValue = normalizeNumber(raw.listedMarketValue);
    const priceToMarketRatio = normalizeNumber(raw.priceToMarketRatio)
        ?? (carPrice && listedMarketValue ? Number((carPrice / listedMarketValue).toFixed(3)) : null);
    const priceGapToMarket = normalizeNumber(raw.priceGapToMarket)
        ?? (carPrice && listedMarketValue ? carPrice - listedMarketValue : null);
    const estimatedMonthlyPayment = normalizeNumber(raw.estimatedMonthlyPayment);
    const listingCompleteness = normalizeNumber(raw.listingCompleteness);

    return {
        condition: raw.condition || 'unknown',
        fuelType: raw.fuelType || 'unknown',
        bodyStyle: raw.bodyStyle || 'unknown',
        transmission: raw.transmission || 'unknown',
        drivetrain: raw.drivetrain || 'unknown',
        titleStatus: normalizeTitleStatus(raw),
        accidentSeverity: normalizeAccidentSeverity(raw),
        hasCleanTitle: Boolean(raw.hasCleanTitle),
        hasAccidentHistory: Boolean(raw.hasAccidentHistory),
        hasSalvageTitle: Boolean(raw.hasSalvageTitle),
        oneOwner: inferredOneOwner,
        ownerCount: normalizedOwnerCount,
        serviceRecords: Boolean(raw.serviceRecords),
        serviceRecordCount,
        mileagePerYear: normalizeNumber(raw.mileagePerYear) ?? (
            age !== null && mileage !== null ? Math.round(mileage / Math.max(1, age)) : null
        ),
        listedMarketValue,
        priceToMarketRatio,
        priceGapToMarket,
        estimatedMonthlyPayment,
        listingCompleteness: listingCompleteness ?? estimateListingCompleteness(car, raw),
    };
}

function deriveAttributesFromText(text) {
    const lower = (text || '').toLowerCase();
    const noAccidentSignal = /\b(no accidents|accident[- ]free|clean carfax)\b/.test(lower);
    const accidentMention = /\b(accident|collision|damage)\b/.test(lower);

    const ownerCount = extractCount(lower, [
        /\b(\d+)\s*-\s*owner\b/i,
        /\b(\d+)\s+owner\b/i,
    ]);
    const serviceRecordCount = extractCount(lower, [
        /\b(\d+)\s+service records?\b/i,
    ]);
    const listedMarketValue = extractMoneyValue(text, [
        /(?:carfax|kbb|market)\s*value[^$\d]*\$\s*([\d,]{3,9})/i,
        /\$\s*([\d,]{3,9})\s*(?:carfax|kbb|market)\s*value/i,
    ]);
    const estimatedMonthlyPayment = extractMoneyValue(text, [
        /\$\s*([\d,]{2,6})\s*\/\s*mo\b/i,
    ], { min: 50, max: 5000 });

    return {
        condition: detectCondition(lower),
        fuelType: detectFirst(lower, {
            electric: /\belectric\b/,
            hybrid: /\bhybrid\b/,
            diesel: /\bdiesel\b/,
            gas: /\b(gas|gasoline)\b/,
        }),
        bodyStyle: detectFirst(lower, {
            suv: /\bsuv\b/,
            sedan: /\bsedan\b/,
            truck: /\btruck\b/,
            hatchback: /\bhatchback\b/,
            coupe: /\bcoupe\b/,
            minivan: /\b(minivan|van)\b/,
            wagon: /\bwagon\b/,
            convertible: /\bconvertible\b/,
        }),
        transmission: detectFirst(lower, {
            automatic: /\bautomatic\b/,
            manual: /\bmanual\b/,
            cvt: /\bcvt\b/,
        }),
        drivetrain: detectFirst(lower, {
            awd: /\bawd\b/,
            four_wd: /\b(4wd|4x4)\b/,
            fwd: /\bfwd\b/,
            rwd: /\brwd\b/,
        }),
        titleStatus: detectTitleStatus(lower),
        hasCleanTitle: /\b(clean title|clean carfax)\b/.test(lower),
        hasSalvageTitle: /\b(salvage|rebuilt title|flood damage|lemon)\b/.test(lower),
        accidentSeverity: detectAccidentSeverity(lower, noAccidentSignal, accidentMention),
        hasAccidentHistory: accidentMention && !noAccidentSignal,
        oneOwner: ownerCount === 1 || /\b(one owner|single owner)\b/.test(lower),
        ownerCount,
        serviceRecords: /\b(service records|maintenance records|dealer maintained|well maintained)\b/.test(lower),
        serviceRecordCount,
        listedMarketValue,
        estimatedMonthlyPayment,
    };
}

function buildScoreExplanation({
    overallScore,
    valueScore,
    conditionScore,
    buyScore,
    matchScore,
    confidenceScore,
    positives,
    concerns,
}) {
    const topPositives = positives.slice(0, 4);
    const topConcerns = concerns.slice(0, 3);
    const positivesText = topPositives.length
        ? topPositives.join('; ')
        : 'limited strong positives in the listing data';
    const concernsText = topConcerns.length
        ? topConcerns.join('; ')
        : 'no major risk flags detected from available listing text';

    return `Overall ${overallScore}/10 (Value ${valueScore}, Condition ${conditionScore}, Buy ${buyScore}, Match ${matchScore}, Confidence ${confidenceScore}). Positives: ${positivesText}. Risks: ${concernsText}.`;
}

function describeBudgetFit(price, budget) {
    if (!price || !budget) return 'unknown';
    const ratio = price / budget;
    if (ratio <= 0.9) return 'under_budget';
    if (ratio <= 1.0) return 'within_budget';
    if (ratio <= 1.15) return 'near_budget_limit';
    return 'over_budget';
}

function describeMarketPosition(priceToMarketRatio) {
    if (priceToMarketRatio === null) return 'unknown';
    if (priceToMarketRatio <= 0.92) return 'below_market';
    if (priceToMarketRatio <= 1.02) return 'at_market';
    return 'above_market';
}

function normalizeBudgetContext(rawBudget) {
    const numeric = normalizeNumber(String(rawBudget || '').replace(/[^\d]/g, ''));
    if (!numeric) {
        return {
            totalBudget: DEFAULT_TOTAL_BUDGET,
            monthlyBudget: Math.round(DEFAULT_TOTAL_BUDGET / MONTHLY_TO_TOTAL_MULTIPLIER),
        };
    }

    if (numeric <= MONTHLY_BUDGET_THRESHOLD) {
        return {
            totalBudget: numeric * MONTHLY_TO_TOTAL_MULTIPLIER,
            monthlyBudget: numeric,
        };
    }

    return {
        totalBudget: numeric,
        monthlyBudget: Math.round(numeric / MONTHLY_TO_TOTAL_MULTIPLIER),
    };
}

function estimateListingCompleteness(car, attributes) {
    const checks = [
        normalizeNumber(car.priceNumeric) !== null,
        normalizeNumber(car.year) !== null,
        normalizeNumber(car.mileage) !== null,
        (attributes.condition || 'unknown') !== 'unknown',
        normalizeTitleStatus(attributes) !== 'unknown',
        normalizeCount(attributes.ownerCount ?? attributes.owners) !== null,
        normalizeCount(attributes.serviceRecordCount) !== null || Boolean(attributes.serviceRecords),
        (attributes.fuelType || 'unknown') !== 'unknown',
        (attributes.bodyStyle || 'unknown') !== 'unknown',
        (attributes.drivetrain || 'unknown') !== 'unknown',
        normalizeNumber(attributes.listedMarketValue) !== null,
        normalizeNumber(attributes.estimatedMonthlyPayment) !== null,
    ];

    const present = checks.filter(Boolean).length;
    return Math.round((present / checks.length) * 100);
}

function normalizeTitleStatus(attributes) {
    const explicit = `${attributes.titleStatus || ''}`.toLowerCase();
    if (['clean', 'salvage', 'rebuilt'].includes(explicit)) return explicit;
    if (attributes.hasSalvageTitle) return 'salvage';
    if (attributes.hasCleanTitle) return 'clean';
    if (/\brebuilt title\b/.test(explicit)) return 'rebuilt';
    return 'unknown';
}

function normalizeAccidentSeverity(attributes) {
    const explicit = `${attributes.accidentSeverity || ''}`.toLowerCase();
    if (['none', 'minor', 'moderate', 'severe'].includes(explicit)) return explicit;
    if (attributes.hasAccidentHistory) return 'moderate';
    return 'none';
}

function detectTitleStatus(lowerText) {
    if (/\bsalvage\b/.test(lowerText)) return 'salvage';
    if (/\brebuilt title\b/.test(lowerText)) return 'rebuilt';
    if (/\b(clean title|clean carfax)\b/.test(lowerText)) return 'clean';
    return 'unknown';
}

function detectAccidentSeverity(lowerText, noAccidentSignal, accidentMention) {
    if (noAccidentSignal || !accidentMention) return 'none';
    if (/\b(severe|major|structural|frame damage|flood damage)\b/.test(lowerText)) return 'severe';
    if (/\b(minor damage|cosmetic damage)\b/.test(lowerText)) return 'minor';
    return 'moderate';
}

function detectCondition(lowerText) {
    if (!lowerText) return 'unknown';
    if (/\b(needs work|mechanic special|as-is|as is|project car)\b/.test(lowerText)) return 'poor';
    if (/\b(excellent condition|like new|mint condition|immaculate)\b/.test(lowerText)) return 'excellent';
    if (/\b(good condition|great condition|well maintained|clean interior)\b/.test(lowerText)) return 'good';
    if (/\b(fair condition|normal wear|cosmetic damage)\b/.test(lowerText)) return 'fair';
    return 'unknown';
}

function detectFirst(text, regexByLabel) {
    for (const [label, regex] of Object.entries(regexByLabel)) {
        if (regex.test(text)) return label;
    }
    return 'unknown';
}

function extractCount(text, regexes) {
    for (const regex of regexes) {
        const match = text.match(regex);
        if (!match) continue;
        const parsed = normalizeCount(match[1]);
        if (parsed !== null) return parsed;
    }
    return null;
}

function extractMoneyValue(text, regexes, bounds = { min: 1000, max: 250000 }) {
    for (const regex of regexes) {
        const match = text.match(regex);
        if (!match) continue;
        const parsed = normalizeNumber(match[1].replace(/,/g, ''));
        if (parsed === null) continue;
        if (parsed >= bounds.min && parsed <= bounds.max) return parsed;
    }
    return null;
}

function normalizeNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

function normalizeCount(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    if (numeric < 0) return null;
    return Math.round(numeric);
}

function addReason(list, text) {
    if (!text) return;
    if (!list.includes(text)) list.push(text);
}

function clampScore(score) {
    if (!Number.isFinite(score)) return 5;
    return Math.max(1, Math.min(10, Math.round(score)));
}
