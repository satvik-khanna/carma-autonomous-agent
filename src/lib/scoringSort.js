/**
 * Deterministic ranking order for car results.
 * Primary key is overall score (high -> low) with stable tie-breakers.
 */
export function compareCarsByScoreDesc(a, b) {
    const scoreOrder = [
        'overallScore',
        'buyScore',
        'conditionScore',
        'valueScore',
        'matchScore',
        'confidenceScore',
    ];

    for (const key of scoreOrder) {
        const diff = toNumber(b?.[key]) - toNumber(a?.[key]);
        if (diff !== 0) return diff;
    }

    // Prefer cheaper listing when score quality is tied.
    const priceDiff = normalizedPrice(a?.priceNumeric) - normalizedPrice(b?.priceNumeric);
    if (priceDiff !== 0) return priceDiff;

    // Prefer newer model when still tied.
    const yearDiff = toNumber(b?.year) - toNumber(a?.year);
    if (yearDiff !== 0) return yearDiff;

    return 0;
}

export function sortCarsByScoreDesc(cars) {
    return [...(cars || [])].sort(compareCarsByScoreDesc);
}

function toNumber(value) {
    return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function normalizedPrice(price) {
    return Number.isFinite(Number(price)) ? Number(price) : Number.MAX_SAFE_INTEGER;
}
