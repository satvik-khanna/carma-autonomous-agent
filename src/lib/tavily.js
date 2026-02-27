import { tavily } from '@tavily/core';

const client = tavily({ apiKey: process.env.TAVILY_API_KEY });

/**
 * Search for car listings using Tavily across multiple car sites.
 * @param {Object} params
 * @param {string} params.query - Search query (e.g., "2024 Toyota Camry sedan")
 * @param {string} [params.location] - Location filter
 * @param {number} [params.maxResults=10] - Max results to return
 * @returns {Promise<Array>} Normalized car listings
 */
export async function searchCars({ query, location, maxResults = 10 }) {
    const searchQuery = buildSearchQuery(query, location);

    const response = await client.search(searchQuery, {
        searchDepth: 'advanced',
        maxResults,
        includeDomains: [
            'cars.com',
            'cargurus.com',
            'autotrader.com',
            'carfax.com',
            'truecar.com',
            'edmunds.com',
        ],
        includeAnswer: true,
    });

    const listings = (response.results || []).map(normalizeResult);
    return listings;
}

/**
 * Build a search query string for car listings.
 */
function buildSearchQuery(query, location) {
    let searchStr = `${query} for sale`;
    if (location) {
        searchStr += ` near ${location}`;
    }
    searchStr += ' price mileage year condition clean title one owner service records carfax value $/mo';
    return searchStr;
}

/**
 * Normalize a Tavily search result into a common car listing format.
 */
function normalizeResult(result, index) {
    const { title, url, content } = result;
    const searchableText = `${title || ''} ${content || ''}`.trim();

    // Extract source from URL
    let source = 'Unknown';
    try {
        const hostname = new URL(url).hostname.replace('www.', '');
        source = hostname.split('.')[0];
        source = source.charAt(0).toUpperCase() + source.slice(1);
    } catch { }

    const priceNumeric = extractPriceNumber(searchableText);
    const year = extractYear(searchableText);
    const mileage = extractMileage(searchableText);
    const attributes = extractVehicleAttributes(searchableText, {
        year,
        mileage,
        priceNumeric,
    });

    return {
        id: `car-${Date.now()}-${index}`,
        title: title || 'Unknown Vehicle',
        price: priceNumeric ? formatPrice(priceNumeric) : null,
        priceNumeric,
        year,
        mileage,
        description: content || '',
        url,
        source,
        image: result?.images?.[0] || result?.image || null,
        attributes,
        listingType: 'buy',
        fetchedAt: new Date().toISOString(),
    };
}

/**
 * Extract a plausible vehicle listing price.
 */
function extractPriceNumber(text) {
    if (!text) return null;
    const matches = [...text.matchAll(/\$[\s]?([\d,]{3,9})/g)];

    for (const match of matches) {
        const parsed = parseInt(match[1].replace(/,/g, ''), 10);
        if (!Number.isNaN(parsed) && parsed >= 1000 && parsed <= 250000) {
            return parsed;
        }
    }

    return null;
}

function extractYear(text) {
    if (!text) return null;
    const currentYear = new Date().getFullYear() + 1;
    const matches = [...text.matchAll(/\b(19[8-9]\d|20\d{2})\b/g)];

    for (const match of matches) {
        const parsed = parseInt(match[1], 10);
        if (parsed <= currentYear) {
            return parsed;
        }
    }

    return null;
}

function extractMileage(text) {
    if (!text) return null;

    const mileageK = text.match(/\b([\d,.]{1,5})\s*k\s*(?:miles|mi)\b/i);
    if (mileageK) {
        const parsed = Math.round(parseFloat(mileageK[1].replace(/,/g, '')) * 1000);
        if (!Number.isNaN(parsed)) return parsed;
    }

    const mileage = text.match(/\b([\d,]{2,7})\s*(?:miles|mi)\b/i);
    if (mileage) {
        const parsed = parseInt(mileage[1].replace(/,/g, ''), 10);
        if (!Number.isNaN(parsed)) return parsed;
    }

    return null;
}

function extractVehicleAttributes(text, { year, mileage, priceNumeric }) {
    const lower = (text || '').toLowerCase();
    const mentionsNoAccident = /\b(no accidents|accident[- ]free|clean carfax)\b/.test(lower);
    const mentionsAccident = /\b(accident|collision|damage)\b/.test(lower);
    const hasAccidentHistory = mentionsAccident && !mentionsNoAccident;
    const titleStatus = detectTitleStatus(lower);
    const hasSalvageTitle = titleStatus === 'salvage' || titleStatus === 'rebuilt';
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
    const estimatedMonthlyPayment = extractMoneyValue(
        text,
        [/\$\s*([\d,]{2,6})\s*\/\s*mo\b/i],
        { min: 50, max: 5000 }
    );
    const priceToMarketRatio = priceNumeric && listedMarketValue
        ? Number((priceNumeric / listedMarketValue).toFixed(3))
        : null;
    const priceGapToMarket = priceNumeric && listedMarketValue
        ? priceNumeric - listedMarketValue
        : null;
    const mileagePerYear = year && mileage
        ? Math.round(mileage / Math.max(1, new Date().getFullYear() - year))
        : null;

    const attributes = {
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
        titleStatus,
        accidentSeverity: detectAccidentSeverity(lower, mentionsNoAccident, mentionsAccident),
        hasCleanTitle: titleStatus === 'clean' || /\bclean carfax\b/.test(lower),
        hasAccidentHistory,
        hasSalvageTitle,
        oneOwner: ownerCount === 1 || /\b(one owner|single owner)\b/.test(lower),
        ownerCount,
        serviceRecords: /\b(service records|maintenance records|dealer maintained|well maintained)\b/.test(lower),
        serviceRecordCount,
        listedMarketValue,
        estimatedMonthlyPayment,
        priceToMarketRatio,
        priceGapToMarket,
        mileagePerYear,
    };

    attributes.listingCompleteness = estimateListingCompleteness({
        priceNumeric,
        year,
        mileage,
        attributes,
    });

    return attributes;
}

function detectTitleStatus(lowerText) {
    if (/\bsalvage\b/.test(lowerText)) return 'salvage';
    if (/\brebuilt title\b/.test(lowerText)) return 'rebuilt';
    if (/\b(clean title|clean carfax)\b/.test(lowerText)) return 'clean';
    return 'unknown';
}

function detectAccidentSeverity(lowerText, mentionsNoAccident, mentionsAccident) {
    if (mentionsNoAccident || !mentionsAccident) return 'none';
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
        if (regex.test(text)) {
            return label;
        }
    }
    return 'unknown';
}

function formatPrice(priceNumber) {
    return `$${priceNumber.toLocaleString('en-US')}`;
}

function extractCount(text, regexes) {
    for (const regex of regexes) {
        const match = text.match(regex);
        if (!match) continue;
        const parsed = parseInt(match[1], 10);
        if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 20) {
            return parsed;
        }
    }
    return null;
}

function extractMoneyValue(text, regexes, bounds = { min: 1000, max: 250000 }) {
    for (const regex of regexes) {
        const match = text.match(regex);
        if (!match) continue;
        const parsed = parseInt(match[1].replace(/,/g, ''), 10);
        if (!Number.isNaN(parsed) && parsed >= bounds.min && parsed <= bounds.max) {
            return parsed;
        }
    }
    return null;
}

function estimateListingCompleteness({ priceNumeric, year, mileage, attributes }) {
    const checks = [
        normalizeNumber(priceNumeric) !== null,
        normalizeNumber(year) !== null,
        normalizeNumber(mileage) !== null,
        attributes.condition !== 'unknown',
        attributes.titleStatus !== 'unknown',
        normalizeNumber(attributes.ownerCount) !== null,
        normalizeNumber(attributes.serviceRecordCount) !== null || attributes.serviceRecords,
        attributes.fuelType !== 'unknown',
        attributes.bodyStyle !== 'unknown',
        attributes.drivetrain !== 'unknown',
        normalizeNumber(attributes.listedMarketValue) !== null,
        normalizeNumber(attributes.estimatedMonthlyPayment) !== null,
    ];

    const present = checks.filter(Boolean).length;
    return Math.round((present / checks.length) * 100);
}

function normalizeNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}
