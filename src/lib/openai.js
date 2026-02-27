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

    const marketContext = buildPeerMarketContext(cars);
    const scored = cars.map((car, index) => scoreCar(car, preferences, marketContext[index]));
    return sortCarsByScoreDesc(scored);
}

function scoreCar(car, preferences, marketContext = {}) {
    const budget = normalizeBudgetContext(preferences.budget);
    const reliabilityIntent = Boolean(preferences.reliabilityIntent);
    const year = normalizeNumber(car.year);
    const age = year ? Math.max(0, new Date().getFullYear() - year) : null;
    const mileage = normalizeNumber(car.mileage);
    const priceNumeric = normalizeNumber(car.priceNumeric);
    const attributes = mergeAttributes(car, age, mileage, marketContext);

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

    if (attributes.priceRiskLevel === 'high') {
        valueScore -= 3;
        addReason(concerns, attributes.priceRiskReason || 'asking price is too far below comparable listings');
    } else if (attributes.priceRiskLevel === 'medium') {
        valueScore -= 2;
        addReason(concerns, attributes.priceRiskReason || 'asking price is unusually low compared with similar listings');
    } else if (attributes.priceToMarketRatio !== null) {
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

    if (attributes.sellerType === 'owner') {
        valueScore += 1;
        addReason(positives, 'private-party listing can reduce dealer markup');
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

    if (attributes.mileageMissingRisk === 'high') {
        conditionScore -= 2;
        addReason(concerns, attributes.mileageMissingReason || 'mileage is missing on an older listing');
    } else if (attributes.mileageMissingRisk === 'medium') {
        conditionScore -= 1;
        addReason(concerns, attributes.mileageMissingReason || 'mileage is missing from the listing');
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

    if (attributes.hasVin) {
        conditionScore += 1;
        addReason(positives, 'VIN is present');
    }

    if (attributes.imageCount >= 8) {
        conditionScore += 1;
        addReason(positives, 'photo coverage is strong');
    } else if (attributes.imageCount <= 1) {
        conditionScore -= 1;
        addReason(concerns, 'very limited photo coverage');
    }

    let reliabilityScore = clampScore(attributes.redditReliabilityScore ?? attributes.researchScore ?? 5);
    if (attributes.researchAvailable) {
        if (attributes.reliabilityRating === 'reliable') {
            reliabilityScore = clampScore(reliabilityScore + 1);
        } else if (attributes.reliabilityRating === 'mostly_reliable') {
            reliabilityScore = clampScore(reliabilityScore + 0.5);
        } else if (attributes.reliabilityRating === 'questionable') {
            reliabilityScore = clampScore(reliabilityScore - 1);
        } else if (attributes.reliabilityRating === 'unreliable') {
            reliabilityScore = clampScore(reliabilityScore - 2);
        }

        if (reliabilityScore >= 8) {
            conditionScore += 1;
            addReason(positives, 'Reddit and mechanic feedback point to strong reliability');
        } else if (reliabilityScore >= 6) {
            addReason(positives, 'Reddit reliability feedback is generally positive');
        } else if (reliabilityScore <= 4) {
            conditionScore -= 2;
            addReason(concerns, 'Reddit reliability feedback is weak');
        } else {
            addReason(concerns, 'Reddit reliability feedback is mixed');
        }

        if (attributes.knownIssues.length > 0) {
            addReason(concerns, `known issues mentioned: ${attributes.knownIssues.slice(0, 2).join(', ')}`);
        }
    } else if (reliabilityIntent) {
        addReason(concerns, 'no Reddit reliability research was available for this search');
    }
    conditionScore = clampScore(conditionScore);

    let researchSupportScore = 5;
    if (reliabilityIntent) {
        if (!attributes.researchAvailable) {
            researchSupportScore = 2;
        } else if (reliabilityScore >= 8) {
            researchSupportScore = 10;
        } else if (reliabilityScore >= 6) {
            researchSupportScore = 8;
        } else if (reliabilityScore >= 5) {
            researchSupportScore = 6;
        } else {
            researchSupportScore = 3;
        }
    } else if (attributes.researchAvailable) {
        researchSupportScore = 6;
    }

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
        if (attributes.mileageMissingRisk === 'high') {
            buyScore -= 2;
            addReason(concerns, attributes.mileageMissingReason || 'odometer detail missing on an older vehicle');
        } else {
            buyScore -= 1;
            addReason(concerns, attributes.mileageMissingReason || 'odometer detail missing');
        }
    }

    if (attributes.priceRiskLevel === 'high') {
        buyScore -= 2;
    } else if (attributes.priceRiskLevel === 'medium') {
        buyScore -= 1;
    } else if (attributes.priceToMarketRatio !== null) {
        if (attributes.priceToMarketRatio <= 0.95) buyScore += 1;
        if (attributes.priceToMarketRatio > 1.1) buyScore -= 1;
    }

    if (attributes.sellerType === 'dealer' && attributes.serviceRecordCount === null && !attributes.hasVin) {
        buyScore -= 1;
        addReason(concerns, 'dealer listing lacks strong supporting detail');
    }

    if (attributes.titleStatus === 'rebuilt') buyScore -= 1;
    if (attributes.titleStatus === 'salvage') buyScore -= 2;
    if (attributes.accidentSeverity === 'severe') buyScore -= 1;
    if (attributes.researchAvailable) {
        if (reliabilityScore >= 8) {
            buyScore += 2;
        } else if (reliabilityScore >= 6) {
            buyScore += 1;
        } else if (reliabilityScore <= 4) {
            buyScore -= 2;
        } else if (reliabilityScore <= 5) {
            buyScore -= 1;
        }

        if (attributes.priceVerdict === 'overpriced') {
            addReason(concerns, 'Reddit price discussion suggests it may be overpriced');
        }
    }
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

    if (attributes.queryMatchScore >= 8) {
        matchScore += 2;
        addReason(positives, 'strong match for the requested model');
    } else if (attributes.queryMatchScore >= 4) {
        matchScore += 1;
    } else if (attributes.queryMatchScore <= 1) {
        matchScore -= 2;
        addReason(concerns, 'weak match for the requested model');
    }

    if (attributes.locationMatchScore >= 4) {
        matchScore += 1;
        addReason(positives, 'location aligns with your search');
    }

    if (reliabilityIntent) {
        if (attributes.researchAvailable) {
            if (reliabilityScore >= 8) {
                matchScore += 3;
                addReason(positives, 'strong fit for a reliability-focused search');
            } else if (reliabilityScore >= 6) {
                matchScore += 2;
                addReason(positives, 'solid fit for a reliability-focused search');
            } else if (reliabilityScore <= 4) {
                matchScore -= 3;
                addReason(concerns, 'poor fit for a reliability-focused search');
            } else {
                matchScore -= 2;
                addReason(concerns, 'mixed reliability feedback for a reliability-focused search');
            }
        } else {
            matchScore -= 2;
            addReason(concerns, 'reliability-focused search without Reddit research support');
        }
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
    if (attributes.hasVin) confidenceScore += 0.5;
    if (attributes.imageCount >= 5) confidenceScore += 0.5;
    if (attributes.sellerPhoneCount >= 1) confidenceScore += 0.5;
    if (attributes.listingAgeDays !== null && attributes.listingAgeDays <= 14) confidenceScore += 0.5;
    if (attributes.mileageMissingRisk === 'medium') confidenceScore -= 0.5;
    if (attributes.mileageMissingRisk === 'high') confidenceScore -= 1.5;
    if (attributes.priceRiskLevel === 'medium') confidenceScore -= 1;
    if (attributes.priceRiskLevel === 'high') confidenceScore -= 1.5;
    if (attributes.peerCount >= 3 && attributes.priceRiskLevel === 'none' && attributes.priceToMarketRatio !== null) {
        confidenceScore += 0.5;
    }
    if (attributes.researchAvailable) confidenceScore += 0.5;
    if (reliabilityIntent && !attributes.researchAvailable) confidenceScore -= 1;
    confidenceScore = clampScore(confidenceScore);

    if (confidenceScore >= 8) {
        addReason(positives, 'listing has rich detail for scoring confidence');
    } else if (confidenceScore <= 5) {
        addReason(concerns, 'limited listing detail reduces score certainty');
    }

    let overallScore = clampScore(
        Math.round(
            reliabilityIntent
                ? (
                    (valueScore * 0.20) +
                    (conditionScore * 0.20) +
                    (buyScore * 0.22) +
                    (matchScore * 0.12) +
                    (reliabilityScore * 0.18) +
                    (confidenceScore * 0.08)
                )
                : (
                    (valueScore * 0.24) +
                    (conditionScore * 0.23) +
                    (buyScore * 0.25) +
                    (matchScore * 0.18) +
                    (confidenceScore * 0.10)
                )
        )
    );

    if (attributes.priceRiskLevel === 'high' && overallScore > 5) {
        overallScore = 5;
    }
    if (attributes.mileageMissingRisk === 'high' && overallScore > 6) {
        overallScore = 6;
    }
    if (reliabilityIntent) {
        if (!attributes.researchAvailable) {
            overallScore = clampScore(overallScore - 1);
        } else if (reliabilityScore >= 8) {
            overallScore = clampScore(overallScore + 1);
        } else if (reliabilityScore <= 4) {
            overallScore = clampScore(overallScore - 1);
        }
    }

    const recommendation = overallScore >= 7
        && buyScore >= 7
        && conditionScore >= 6
        && (!reliabilityIntent || !attributes.researchAvailable || reliabilityScore >= 6)
        && attributes.priceRiskLevel !== 'high'
        && attributes.mileageMissingRisk !== 'high'
        ? 'buy'
        : 'consider';

    return {
        ...car,
        valueScore,
        conditionScore,
        buyScore,
        matchScore,
        reliabilityScore,
        researchSupportScore,
        confidenceScore,
        overallScore,
        recommendation,
        scoreBreakdown: {
            budgetFit: describeBudgetFit(priceNumeric, budget.totalBudget),
            marketPosition: describeMarketPosition(attributes.priceToMarketRatio),
            titleStatus: attributes.titleStatus,
            accidentSeverity: attributes.accidentSeverity,
            sellerType: attributes.sellerType,
            ownerCount: attributes.ownerCount,
            serviceRecordCount: attributes.serviceRecordCount,
            mileagePerYear: attributes.mileagePerYear,
            listingAgeDays: attributes.listingAgeDays,
            hasVin: attributes.hasVin,
            imageCount: attributes.imageCount,
            listingCompleteness: attributes.listingCompleteness,
            peerMedianPrice: attributes.peerMedianPrice,
            peerCount: attributes.peerCount,
            priceRisk: attributes.priceRiskLevel,
            priceDeviationFromPeers: attributes.priceDeviationFromPeers,
            mileageMissingRisk: attributes.mileageMissingRisk,
            researchAvailable: attributes.researchAvailable,
            researchScore: attributes.researchScore,
            redditReliabilityScore: attributes.redditReliabilityScore,
            reliabilityRating: attributes.reliabilityRating,
            reliabilityIntent,
            researchSupportScore,
            priceVerdict: attributes.priceVerdict,
        },
        aiExplanation: buildScoreExplanation({
            overallScore,
            valueScore,
            conditionScore,
            buyScore,
            matchScore,
            reliabilityScore,
            confidenceScore,
            positives,
            concerns,
            priceRiskLevel: attributes.priceRiskLevel,
            priceRiskReason: attributes.priceRiskReason,
            mileageMissingRisk: attributes.mileageMissingRisk,
            mileageMissingReason: attributes.mileageMissingReason,
            researchAvailable: attributes.researchAvailable,
            researchVerdict: attributes.researchVerdict,
            reliabilityIntent,
        }),
    };
}

function mergeAttributes(car, age, mileage, marketContext = {}) {
    const derived = deriveAttributesFromText(`${car.title || ''} ${car.description || ''}`, car);
    const raw = { ...derived, ...(car.attributes || {}) };
    const research = normalizeResearchSignals(car.research);
    const carPrice = normalizeNumber(car.priceNumeric);

    const ownerCount = normalizeCount(raw.ownerCount ?? raw.owners);
    const inferredOneOwner = ownerCount === 1 || Boolean(raw.oneOwner);
    const normalizedOwnerCount = ownerCount ?? (inferredOneOwner ? 1 : null);
    const serviceRecordCount = normalizeCount(raw.serviceRecordCount);
    const listedMarketValue = normalizeNumber(raw.listedMarketValue);
    const peerMedianPrice = normalizeNumber(raw.peerMedianPrice) ?? normalizeNumber(marketContext.peerMedianPrice);
    const peerCount = normalizeCount(raw.peerCount) ?? normalizeCount(marketContext.peerCount);
    const marketReferencePrice = listedMarketValue ?? peerMedianPrice;
    const priceToMarketRatio = normalizeNumber(raw.priceToMarketRatio)
        ?? (carPrice && marketReferencePrice ? Number((carPrice / marketReferencePrice).toFixed(3)) : null);
    const priceGapToMarket = normalizeNumber(raw.priceGapToMarket)
        ?? (carPrice && marketReferencePrice ? carPrice - marketReferencePrice : null);
    const estimatedMonthlyPayment = normalizeNumber(raw.estimatedMonthlyPayment);
    const listingCompleteness = normalizeNumber(raw.listingCompleteness);
    const imageCount = normalizeCount(raw.imageCount) ?? (Array.isArray(car.images) ? car.images.length : 0);
    const sellerPhoneCount = normalizeCount(raw.sellerPhoneCount)
        ?? (Array.isArray(car.sellerPhoneNumbers) ? car.sellerPhoneNumbers.length : 0);
    const normalizedTitleStatus = normalizeTitleStatus(raw);
    const hasVin = Boolean(raw.hasVin ?? car.vin);
    const resolvedListingCompleteness = listingCompleteness ?? estimateListingCompleteness(car, raw);
    const priceRisk = assessPriceRisk({
        priceNumeric: carPrice,
        age,
        peerMedianPrice,
        priceToMarketRatio,
        hasVin,
        imageCount,
    });
    const mileageMissingRisk = assessMissingMileageRisk({
        mileage,
        age,
        hasVin,
        imageCount,
    });

    return {
        condition: raw.condition || 'unknown',
        fuelType: raw.fuelType || 'unknown',
        bodyStyle: raw.bodyStyle || 'unknown',
        transmission: raw.transmission || 'unknown',
        drivetrain: raw.drivetrain || 'unknown',
        sellerType: raw.sellerType || 'unknown',
        usedNew: raw.usedNew || 'used',
        titleStatus: normalizedTitleStatus,
        accidentSeverity: normalizeAccidentSeverity(raw),
        hasCleanTitle: Boolean(raw.hasCleanTitle),
        hasAccidentHistory: Boolean(raw.hasAccidentHistory),
        hasSalvageTitle: Boolean(raw.hasSalvageTitle),
        hasVin,
        oneOwner: inferredOneOwner,
        ownerCount: normalizedOwnerCount,
        serviceRecords: Boolean(raw.serviceRecords),
        serviceRecordCount,
        mileagePerYear: normalizeNumber(raw.mileagePerYear) ?? (
            age !== null && mileage !== null ? Math.round(mileage / Math.max(1, age)) : null
        ),
        imageCount,
        sellerPhoneCount,
        listingAgeDays: normalizeNumber(raw.listingAgeDays),
        queryMatchScore: normalizeNumber(raw.queryMatchScore) ?? 0,
        locationMatchScore: normalizeNumber(raw.locationMatchScore) ?? 0,
        listedMarketValue,
        peerMedianPrice,
        peerCount: peerCount ?? 0,
        priceToMarketRatio,
        priceGapToMarket,
        priceDeviationFromPeers: normalizeNumber(raw.priceDeviationFromPeers)
            ?? normalizeNumber(marketContext.priceDeviationFromPeers),
        estimatedMonthlyPayment,
        listingCompleteness: resolvedListingCompleteness,
        priceRiskLevel: raw.suspiciouslyLowPrice
            ? 'high'
            : priceRisk.level,
        priceRiskReason: raw.suspiciouslyLowPriceReason || priceRisk.reason,
        mileageMissingRisk: mileageMissingRisk.level,
        mileageMissingReason: mileageMissingRisk.reason,
        researchAvailable: research.available,
        researchScore: research.researchScore,
        redditReliabilityScore: research.reliabilityScore,
        researchVerdict: research.verdict,
        reliabilityRating: research.reliabilityRating,
        shouldBuyVerdict: research.shouldBuyVerdict,
        ownerSatisfaction: research.ownerSatisfaction,
        priceVerdict: research.priceVerdict,
        knownIssues: research.knownIssues,
        prePurchaseChecks: research.prePurchaseChecks,
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

function normalizeResearchSignals(research) {
    if (!research || typeof research !== 'object') {
        return {
            available: false,
            researchScore: null,
            reliabilityScore: null,
            verdict: null,
            reliabilityRating: 'unknown',
            shouldBuyVerdict: 'unknown',
            ownerSatisfaction: 'unknown',
            priceVerdict: 'unknown',
            knownIssues: [],
            prePurchaseChecks: [],
        };
    }

    return {
        available: true,
        researchScore: normalizeNumber(research.researchScore ?? research.research_score),
        reliabilityScore: normalizeNumber(research.reliabilityScore),
        verdict: research.verdict || null,
        reliabilityRating: `${research.reliabilityRating || research.mechanic_advice?.reliability_rating || 'unknown'}`.toLowerCase(),
        shouldBuyVerdict: `${research.shouldBuyVerdict || research.should_i_buy?.reddit_verdict || 'unknown'}`.toLowerCase(),
        ownerSatisfaction: `${research.ownerSatisfaction || research.ownership_experience?.owner_satisfaction || 'unknown'}`.toLowerCase(),
        priceVerdict: `${research.priceVerdict || research.costs_and_value?.price_verdict || 'unknown'}`.toLowerCase(),
        knownIssues: Array.isArray(research.knownIssues)
            ? research.knownIssues
            : Array.isArray(research.mechanic_advice?.known_issues)
                ? research.mechanic_advice.known_issues
                : [],
        prePurchaseChecks: Array.isArray(research.prePurchaseChecks)
            ? research.prePurchaseChecks
            : Array.isArray(research.mechanic_advice?.pre_purchase_checks)
                ? research.mechanic_advice.pre_purchase_checks
                : [],
    };
}

function buildScoreExplanation({
    overallScore,
    valueScore,
    conditionScore,
    buyScore,
    matchScore,
    reliabilityScore,
    confidenceScore,
    positives,
    concerns,
    priceRiskLevel,
    priceRiskReason,
    mileageMissingRisk,
    mileageMissingReason,
    researchAvailable,
    researchVerdict,
    reliabilityIntent,
}) {
    const assessment = overallScore >= 8
        ? 'Strong candidate for follow-up'
        : overallScore >= 6
            ? 'Worth reviewing, but verify details before treating it as a good buy'
            : 'Higher-risk listing unless key details check out directly';
    const topPositives = positives.slice(0, 2);
    const explicitRisks = [];
    if (priceRiskLevel !== 'none' && priceRiskReason) {
        explicitRisks.push(`${priceRiskReason}, so it reads more like a risk flag than a normal discount`);
    }
    if (mileageMissingRisk !== 'none' && mileageMissingReason) {
        explicitRisks.push(mileageMissingReason);
    }
    const remainingConcerns = concerns.filter((concern) => {
        if (priceRiskReason && concern.includes(priceRiskReason)) return false;
        if (mileageMissingReason && concern.includes(mileageMissingReason)) return false;
        return true;
    });
    const topConcerns = [...explicitRisks, ...remainingConcerns]
        .filter((text, index, all) => text && all.indexOf(text) === index)
        .slice(0, 3);
    const positivesText = topPositives.length
        ? topPositives.join('; ')
        : 'few hard positives are actually verified in the listing';
    const concernsText = topConcerns.length
        ? topConcerns.join('; ')
        : 'no major risk flags are visible in the available data';
    const confidenceText = confidenceScore >= 8
        ? 'The score has solid support from the listing details.'
        : confidenceScore >= 6
            ? 'The score is usable, but still needs normal diligence.'
            : 'The score has limited certainty because decision-critical fields are missing or inconsistent.';
    const researchText = researchAvailable
        ? (researchVerdict ? ` Reddit summary: ${researchVerdict}` : ' Reddit research was included in the score.')
        : (reliabilityIntent ? ' Reddit reliability research was requested but not available for this result.' : '');

    return `${assessment}. Overall ${overallScore}/10 (Value ${valueScore}, Condition ${conditionScore}, Buy ${buyScore}, Match ${matchScore}, Reliability ${reliabilityScore}, Confidence ${confidenceScore}). What helps: ${positivesText}. What holds it back: ${concernsText}. ${confidenceText}${researchText}`;
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

function buildPeerMarketContext(cars) {
    return cars.map((car, index) => {
        const comparablePeers = cars.filter((candidate, candidateIndex) =>
            candidateIndex !== index && isComparableMarketPeer(candidate, car)
        );

        const peerPrices = comparablePeers
            .map((candidate) => normalizeNumber(candidate.priceNumeric))
            .filter((value) => value !== null);

        const peerMileage = comparablePeers
            .map((candidate) => normalizeNumber(candidate.mileage))
            .filter((value) => value !== null);

        const priceNumeric = normalizeNumber(car.priceNumeric);
        const peerMedianPrice = median(peerPrices);

        return {
            peerMedianPrice,
            peerMedianMileage: median(peerMileage),
            peerCount: comparablePeers.length,
            priceDeviationFromPeers: priceNumeric !== null && peerMedianPrice
                ? Number(((priceNumeric - peerMedianPrice) / peerMedianPrice).toFixed(3))
                : null,
        };
    });
}

function isComparableMarketPeer(candidate, current) {
    const candidateMake = normalizeText(candidate.make);
    const currentMake = normalizeText(current.make);
    const candidateModel = normalizeText(candidate.model);
    const currentModel = normalizeText(current.model);
    const candidateBody = normalizeText(candidate.attributes?.bodyStyle);
    const currentBody = normalizeText(current.attributes?.bodyStyle);
    const candidateYear = normalizeNumber(candidate.year);
    const currentYear = normalizeNumber(current.year);
    const yearDelta = candidateYear !== null && currentYear !== null
        ? Math.abs(candidateYear - currentYear)
        : 0;

    if (candidateMake && currentMake && candidateMake === currentMake && candidateModel && currentModel && candidateModel === currentModel) {
        return yearDelta <= 4;
    }

    if (candidateMake && currentMake && candidateMake === currentMake && candidateBody && currentBody && candidateBody === currentBody) {
        return yearDelta <= 3;
    }

    const candidateFingerprint = normalizeTitleFingerprint(candidate.title);
    const currentFingerprint = normalizeTitleFingerprint(current.title);
    return candidateFingerprint && currentFingerprint && candidateFingerprint === currentFingerprint;
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

function assessPriceRisk({
    priceNumeric,
    age,
    peerMedianPrice,
    priceToMarketRatio,
    hasVin,
    imageCount,
}) {
    if (priceNumeric === null) {
        return {
            level: 'medium',
            reason: 'asking price is not clearly listed',
        };
    }

    const peerRatio = peerMedianPrice ? priceNumeric / peerMedianPrice : priceToMarketRatio;
    const hardFloor = computeAbsolutePriceFloor(age);
    const weakSupport = !hasVin && imageCount < 5;

    if (peerRatio !== null && peerRatio < 0.58) {
        const percentBelowPeer = Math.round((1 - peerRatio) * 100);
        return {
            level: 'high',
            reason: `asking price is about ${percentBelowPeer}% below comparable listings`,
        };
    }

    if (priceNumeric < hardFloor && weakSupport) {
        return {
            level: 'high',
            reason: `asking price is unusually low for a vehicle in this age range and the listing does not provide enough supporting detail`,
        };
    }

    if ((peerRatio !== null && peerRatio < 0.75) || (priceNumeric < hardFloor)) {
        return {
            level: 'medium',
            reason: 'asking price is noticeably below comparable listings',
        };
    }

    return {
        level: 'none',
        reason: null,
    };
}

function assessMissingMileageRisk({ mileage, age, hasVin, imageCount }) {
    if (mileage !== null) {
        return {
            level: 'none',
            reason: null,
        };
    }

    if (age === null) {
        return {
            level: 'high',
            reason: 'odometer reading is missing, so wear is hard to verify',
        };
    }

    if (age <= 3) {
        return {
            level: 'medium',
            reason: 'odometer reading is missing even though the car is still relatively new',
        };
    }

    if (age <= 7) {
        return {
            level: hasVin || imageCount >= 8 ? 'medium' : 'high',
            reason: 'odometer reading is missing on a mid-age vehicle, which weakens the condition estimate',
        };
    }

    return {
        level: 'high',
        reason: 'odometer reading is missing on an older vehicle, so wear and remaining life are hard to price accurately',
    };
}

function computeAbsolutePriceFloor(age) {
    if (age === null) return 2500;
    if (age <= 3) return 9000;
    if (age <= 6) return 6500;
    if (age <= 10) return 4000;
    if (age <= 15) return 2500;
    return 1800;
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
    if (['none', 'minor', 'moderate', 'severe', 'unknown'].includes(explicit)) return explicit;
    if (attributes.hasAccidentHistory) return 'moderate';
    return 'unknown';
}

function detectTitleStatus(lowerText) {
    if (/\bsalvage\b/.test(lowerText)) return 'salvage';
    if (/\brebuilt title\b/.test(lowerText)) return 'rebuilt';
    if (/\b(clean title|clean carfax)\b/.test(lowerText)) return 'clean';
    return 'unknown';
}

function detectAccidentSeverity(lowerText, noAccidentSignal, accidentMention) {
    if (noAccidentSignal) return 'none';
    if (!accidentMention) return 'unknown';
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
    if (value === null || value === undefined || value === '') return null;
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

function normalizeText(value) {
    return `${value || ''}`.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function normalizeTitleFingerprint(value) {
    return normalizeText(value)
        .split(' ')
        .filter((token) => token.length > 2)
        .slice(0, 4)
        .join(' ');
}

function median(values) {
    if (!Array.isArray(values) || values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const middleIndex = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) {
        return sorted[middleIndex];
    }
    return Math.round((sorted[middleIndex - 1] + sorted[middleIndex]) / 2);
}

function clampScore(score) {
    if (!Number.isFinite(score)) return 5;
    return Math.max(1, Math.min(10, Math.round(score)));
}
