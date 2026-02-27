import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';

const PROJECT_ROOT = process.cwd();
const STRUCTURED_DIR = path.join(PROJECT_ROOT, 'backend', 'data', 'craigslist', '04_structured');
const PIPELINE_DIR = path.join(PROJECT_ROOT, 'backend', 'scraper', 'pipeline');
const PIPELINE_SCRIPT = path.join(PIPELINE_DIR, 'run_pipeline.py');
const PIPELINE_TIMEOUT_MS = 4 * 60 * 1000;
const CURRENT_YEAR = new Date().getFullYear();
const RELIABILITY_INTENT_PATTERNS = [
    /\breliable\b/i,
    /\breliability\b/i,
    /\bdependable\b/i,
    /\bdurable\b/i,
    /\bbulletproof\b/i,
    /\btrustworthy\b/i,
    /\blow maintenance\b/i,
    /\blong[-\s]lasting\b/i,
    /\bproblem[-\s]?free\b/i,
    /\btrouble[-\s]?free\b/i,
    /\bno issues\b/i,
];

export async function searchCraigslistCars({ query, location, maxResults = 10 }) {
    const searchContext = analyzeSearchIntent(query);
    const { dataFile, researchApplied } = await ensureStructuredData(searchContext.vehicleQuery, {
        includeResearch: searchContext.reliabilityIntent,
    });
    const prepared = await loadAndPrepareListings({
        dataFile,
        query: searchContext.vehicleQuery,
        location,
        maxResults,
    });

    return {
        listings: prepared.bestListings.map(stripInternalSearchFields),
        searchContext: {
            ...searchContext,
            researchApplied,
        },
    };
}

async function loadAndPrepareListings({ dataFile, query, location, maxResults }) {
    const rawListings = JSON.parse(await fs.readFile(dataFile, 'utf-8'));

    const normalizedListings = rawListings
        .map((listing, index) => normalizeCraigslistListing(listing, index, query, location))
        .filter((listing) => listing.searchSignals.queryMatchScore > 0);
    const dedupedListings = dedupeListings(normalizedListings);

    const qualityAnnotatedListings = dedupedListings.map((listing, _, allListings) =>
        annotateListingQuality(listing, allListings)
    );

    const strictCandidates = qualityAnnotatedListings.filter(passesStrictListingQualityFilter);
    const relaxedCandidates = qualityAnnotatedListings.filter(passesBaselineListingQualityFilter);
    const filteredListings = strictCandidates.length >= Math.min(maxResults, 5)
        ? strictCandidates
        : (relaxedCandidates.length > 0
            ? relaxedCandidates
            : qualityAnnotatedListings.filter((listing) => listing.priceNumeric !== null));

    const bestListings = rankSearchResults(filteredListings, query, location)
        .slice(0, maxResults);

    return {
        bestListings,
        filteredCount: filteredListings.length,
        rawCount: rawListings.length,
    };
}

async function ensureStructuredData(query, { includeResearch = false } = {}) {
    if (includeResearch) {
        const enrichedFile = await findBestDataFile(query, ['listings_enriched_']);
        if (enrichedFile) {
            return { dataFile: enrichedFile, researchApplied: true };
        }

        const structuredFile = await findBestDataFile(query, ['listings_structured_']);
        if (structuredFile) {
            await runCraigslistPipeline(query, { stages: [5] });
            const generatedEnrichedFile = await findBestDataFile(query, ['listings_enriched_']);
            if (generatedEnrichedFile) {
                return { dataFile: generatedEnrichedFile, researchApplied: true };
            }

            return { dataFile: structuredFile, researchApplied: false };
        }

        await runCraigslistPipeline(query, { stages: [1, 2, 3, 4, 5] });
        const generatedFile = await findBestDataFile(query, ['listings_enriched_', 'listings_structured_']);
        if (generatedFile) {
            return {
                dataFile: generatedFile,
                researchApplied: path.basename(generatedFile).startsWith('listings_enriched_'),
            };
        }
    } else {
        const matchedFile = await findBestDataFile(query, ['listings_structured_']);
        if (matchedFile) {
            return { dataFile: matchedFile, researchApplied: false };
        }

        await runCraigslistPipeline(query, { stages: [1, 2, 3, 4] });
        const generatedFile = await findBestDataFile(query, ['listings_structured_']);
        if (generatedFile) {
            return { dataFile: generatedFile, researchApplied: false };
        }
    }

    throw new Error(`Craigslist pipeline did not produce structured output for "${query}".`);
}

async function findBestDataFile(query, prefixes) {
    const entries = await safeReadStructuredDir();
    const files = entries
        .filter((entry) => entry.isFile() && prefixes.some((prefix) => entry.name.startsWith(prefix)) && entry.name.endsWith('.json'))
        .map((entry) => entry.name);

    for (const prefix of prefixes) {
        const exactCandidates = slugCandidates(query).map(
            (slug) => `${prefix}${slug}.json`
        );

        for (const candidate of exactCandidates) {
            if (files.includes(candidate)) {
                return path.join(STRUCTURED_DIR, candidate);
            }
        }
    }

    const queryTokens = tokenize(query);
    const best = files
        .map((file) => ({
            file,
            score: scoreFileMatch(file, queryTokens),
        }))
        .filter((candidate) => candidate.score >= Math.max(2, queryTokens.length))
        .sort((a, b) => b.score - a.score)[0];

    return best ? path.join(STRUCTURED_DIR, best.file) : null;
}

async function safeReadStructuredDir() {
    try {
        return await fs.readdir(STRUCTURED_DIR, { withFileTypes: true });
    } catch (error) {
        if (error?.code === 'ENOENT') {
            await fs.mkdir(STRUCTURED_DIR, { recursive: true });
            return [];
        }
        throw error;
    }
}

function scoreFileMatch(fileName, queryTokens) {
    const fileTokens = tokenize(
        fileName
            .replace(/^listings_structured_/, '')
            .replace(/\.json$/, '')
    );

    let score = 0;
    for (const token of queryTokens) {
        if (fileTokens.includes(token)) {
            score += 2;
        } else if (fileTokens.some((fileToken) => fileToken.includes(token) || token.includes(fileToken))) {
            score += 1;
        }
    }
    return score;
}

async function runCraigslistPipeline(query, { stages = [1, 2, 3, 4] } = {}) {
    await new Promise((resolve, reject) => {
        const stageArgs = Array.isArray(stages) && stages.length > 0
            ? ['--stages', ...stages.map(String)]
            : [];
        const child = spawn('python3', [PIPELINE_SCRIPT, query, ...stageArgs], {
            cwd: PIPELINE_DIR,
            env: {
                ...process.env,
                CAR_QUERY: query,
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let outputTail = '';
        const capture = (chunk) => {
            outputTail += chunk.toString();
            if (outputTail.length > 8000) {
                outputTail = outputTail.slice(-8000);
            }
        };

        const timeout = setTimeout(() => {
            child.kill('SIGTERM');
            reject(new Error(`Craigslist pipeline timed out for "${query}".`));
        }, PIPELINE_TIMEOUT_MS);

        child.stdout.on('data', capture);
        child.stderr.on('data', capture);
        child.on('error', (error) => {
            clearTimeout(timeout);
            reject(error);
        });
        child.on('close', (code) => {
            clearTimeout(timeout);
            if (code === 0) {
                resolve();
                return;
            }
            reject(new Error(formatPipelineError(query, outputTail)));
        });
    });
}

function normalizeCraigslistListing(listing, index, query, location) {
    const queryMatchScore = computeQueryMatchScore(listing, query);
    const locationMatchScore = computeLocationMatchScore(listing, location);
    const imageCount = Array.isArray(listing.image_urls) ? listing.image_urls.length : 0;
    const sellerPhoneCount = Array.isArray(listing.seller_phone_numbers)
        ? listing.seller_phone_numbers.length
        : 0;
    const research = normalizeResearchData(listing.research);

    return {
        id: listing.id || `craigslist-${index}`,
        title: listing.title || 'Unknown Vehicle',
        price: listing.price_usd ? formatPrice(listing.price_usd) : null,
        priceNumeric: listing.price_usd ?? null,
        year: listing.year ?? null,
        mileage: listing.mileage ?? null,
        description: trimDescription(listing.description || ''),
        url: listing.url || null,
        source: 'Craigslist',
        image: imageCount > 0 ? listing.image_urls[0] : null,
        images: listing.image_urls || [],
        fetchedAt: listing.parsed_at || listing.extracted_at || new Date().toISOString(),
        listingType: 'buy',
        make: listing.make || null,
        model: listing.model || null,
        trim: listing.trim || null,
        vin: listing.vin || null,
        sellerType: listing.seller_type || null,
        location: listing.location || null,
        latitude: listing.latitude ?? null,
        longitude: listing.longitude ?? null,
        postedAt: listing.posted_at || null,
        updatedAt: listing.updated_at || null,
        sellerPhoneNumbers: listing.seller_phone_numbers || [],
        research,
        attributes: {
            condition: listing.condition_raw || 'unknown',
            fuelType: listing.fuel || 'unknown',
            bodyStyle: listing.body_type || 'unknown',
            transmission: listing.transmission || 'unknown',
            drivetrain: listing.drive || 'unknown',
            titleStatus: listing.title_status || 'unknown',
            sellerType: listing.seller_type || 'unknown',
            usedNew: listing.used_new || 'used',
            hasVin: Boolean(listing.vin),
            imageCount,
            sellerPhoneCount,
            listingAgeDays: computeListingAgeDays(listing.updated_at || listing.posted_at),
            location: listing.location || null,
            queryMatchScore,
            locationMatchScore,
            researchScore: research?.researchScore ?? null,
            redditReliabilityScore: research?.reliabilityScore ?? null,
            researchVerdict: research?.verdict ?? null,
            reliabilityRating: research?.reliabilityRating ?? 'unknown',
        },
        searchSignals: {
            queryMatchScore,
            locationMatchScore,
        },
    };
}

function stripInternalSearchFields(listing) {
    const { searchSignals, ...rest } = listing;
    return rest;
}

function dedupeListings(listings) {
    const groups = new Map();

    for (const listing of listings) {
        const duplicateKey = buildDuplicateListingKey(listing);
        if (!duplicateKey) {
            groups.set(`id:${listing.id}`, listing);
            continue;
        }

        const existing = groups.get(duplicateKey);
        if (!existing || scoreDuplicateCandidate(listing) > scoreDuplicateCandidate(existing)) {
            groups.set(duplicateKey, listing);
        }
    }

    return Array.from(groups.values());
}

function buildDuplicateListingKey(listing) {
    const vin = normalizeIdentifier(listing.vin);
    if (vin && vin.length >= 8) {
        return `vin:${vin}`;
    }

    const title = normalizeTitleForDedup(listing.title);
    const year = normalizeIdentifier(listing.year);
    const price = normalizeIdentifier(listing.priceNumeric);
    const mileage = normalizeIdentifier(listing.mileage);
    const sellerPhones = normalizePhoneList(listing.sellerPhoneNumbers);
    const imageSignature = buildImageSignature(listing.images);

    if (title && year && price && mileage && sellerPhones) {
        return `spec:${title}:${year}:${price}:${mileage}:${sellerPhones}`;
    }

    if (title && year && price && mileage && imageSignature) {
        return `spec:${title}:${year}:${price}:${mileage}:${imageSignature}`;
    }

    if (title && year && price && mileage) {
        return `basic:${title}:${year}:${price}:${mileage}`;
    }

    return null;
}

function scoreDuplicateCandidate(listing) {
    let score = 0;

    score += listing.searchSignals.queryMatchScore * 20;
    score += listing.searchSignals.locationMatchScore * 30;
    score += Math.min(20, listing.attributes.imageCount);
    score += Math.min(12, listing.attributes.sellerPhoneCount * 6);
    if (listing.attributes.hasVin) score += 20;
    if (listing.attributes.titleStatus !== 'unknown') score += 8;
    if (listing.attributes.condition !== 'unknown') score += 8;
    if (listing.latitude !== null && listing.longitude !== null) score += 4;
    if (listing.attributes.listingAgeDays !== null) {
        score += Math.max(0, 10 - Math.min(10, listing.attributes.listingAgeDays));
    }
    score += Math.min(12, Math.round((listing.description?.length || 0) / 400));

    return score;
}

function rankSearchResults(listings) {
    return [...listings].sort((a, b) => {
        const qualityDelta = toNumber(b.searchSignals.listingQualityScore) - toNumber(a.searchSignals.listingQualityScore);
        if (qualityDelta !== 0) return qualityDelta;

        const queryDelta = b.searchSignals.queryMatchScore - a.searchSignals.queryMatchScore;
        if (queryDelta !== 0) return queryDelta;

        const locationDelta = b.searchSignals.locationMatchScore - a.searchSignals.locationMatchScore;
        if (locationDelta !== 0) return locationDelta;

        const yearDelta = toNumber(b.year) - toNumber(a.year);
        if (yearDelta !== 0) return yearDelta;

        const priceDelta = toNumber(a.priceNumeric) - toNumber(b.priceNumeric);
        if (priceDelta !== 0) return priceDelta;

        return toNumber(a.mileage) - toNumber(b.mileage);
    });
}

function annotateListingQuality(listing, allListings) {
    const peerMedianPrice = computePeerMedianPrice(allListings, listing);
    const minimumReasonablePrice = computeMinimumReasonablePrice(listing, peerMedianPrice);
    const suspiciouslyLowPrice = listing.priceNumeric !== null && listing.priceNumeric < minimumReasonablePrice;
    const mileageMissing = listing.mileage === null;
    const vehicleAge = listing.year ? Math.max(0, CURRENT_YEAR - listing.year) : null;
    const listingCompleteness = estimateListingCompleteness(listing);
    const listingQualityScore = computeListingQualityScore({
        ...listing,
        vehicleAge,
        listingCompleteness,
        peerMedianPrice,
        suspiciouslyLowPrice,
        mileageMissing,
    });

    return {
        ...listing,
        attributes: {
            ...listing.attributes,
            peerMedianPrice,
            minimumReasonablePrice,
            suspiciouslyLowPrice,
            suspiciouslyLowPriceReason: suspiciouslyLowPrice
                ? buildLowPriceReason(listing.priceNumeric, minimumReasonablePrice, peerMedianPrice)
                : null,
            mileageMissing,
            listingCompleteness,
            listingQualityScore,
        },
        searchSignals: {
            ...listing.searchSignals,
            listingQualityScore,
        },
    };
}

function passesStrictListingQualityFilter(listing) {
    if (!passesBaselineListingQualityFilter(listing)) {
        return false;
    }

    const vehicleAge = listing.year ? Math.max(0, CURRENT_YEAR - listing.year) : null;
    const olderOrUnknownVehicle = vehicleAge === null || vehicleAge >= 6;
    if (listing.attributes.mileageMissing && olderOrUnknownVehicle) {
        return false;
    }

    if (listing.attributes.suspiciouslyLowPrice && !hasStrongSupportingDetail(listing)) {
        return false;
    }

    return toNumber(listing.attributes.listingQualityScore) >= 55;
}

function passesBaselineListingQualityFilter(listing) {
    if (listing.searchSignals.queryMatchScore <= 0) return false;
    if (listing.priceNumeric === null) return false;
    if (listing.attributes.suspiciouslyLowPrice && listing.priceNumeric < (listing.attributes.minimumReasonablePrice * 0.85)) {
        return false;
    }
    return toNumber(listing.attributes.listingQualityScore) >= 35;
}

function hasStrongSupportingDetail(listing) {
    return Boolean(
        listing.attributes.hasVin ||
        listing.attributes.titleStatus !== 'unknown' ||
        listing.attributes.imageCount >= 6 ||
        listing.attributes.sellerPhoneCount >= 1
    );
}

function computePeerMedianPrice(allListings, currentListing) {
    const comparablePrices = allListings
        .filter((candidate) => candidate.id !== currentListing.id)
        .filter((candidate) => candidate.priceNumeric !== null)
        .filter((candidate) => isComparableListing(candidate, currentListing))
        .map((candidate) => candidate.priceNumeric)
        .sort((a, b) => a - b);

    if (comparablePrices.length === 0) {
        return null;
    }

    const middleIndex = Math.floor(comparablePrices.length / 2);
    if (comparablePrices.length % 2 === 1) {
        return comparablePrices[middleIndex];
    }

    return Math.round((comparablePrices[middleIndex - 1] + comparablePrices[middleIndex]) / 2);
}

function isComparableListing(candidate, currentListing) {
    const sameMake = sanitizeQuery(candidate.make) && sanitizeQuery(candidate.make) === sanitizeQuery(currentListing.make);
    const sameModel = sanitizeQuery(candidate.model) && sanitizeQuery(candidate.model) === sanitizeQuery(currentListing.model);
    const yearDelta = candidate.year && currentListing.year
        ? Math.abs(candidate.year - currentListing.year)
        : 0;

    if (sameMake && sameModel) {
        return yearDelta <= 4;
    }

    return candidate.searchSignals.queryMatchScore >= Math.max(2, currentListing.searchSignals.queryMatchScore - 2);
}

function computeMinimumReasonablePrice(listing, peerMedianPrice) {
    const vehicleAge = listing.year ? Math.max(0, CURRENT_YEAR - listing.year) : null;

    let floor = 1800;
    if (vehicleAge !== null) {
        if (vehicleAge <= 3) floor = 9000;
        else if (vehicleAge <= 6) floor = 6500;
        else if (vehicleAge <= 10) floor = 4000;
        else if (vehicleAge <= 15) floor = 2500;
    }

    if (peerMedianPrice !== null) {
        floor = Math.max(floor, Math.round(peerMedianPrice * 0.5));
    }

    return floor;
}

function estimateListingCompleteness(listing) {
    const checks = [
        listing.priceNumeric !== null,
        listing.year !== null,
        listing.mileage !== null,
        listing.attributes.hasVin,
        listing.attributes.imageCount >= 3,
        listing.attributes.sellerPhoneCount >= 1,
        listing.attributes.titleStatus !== 'unknown',
        listing.attributes.condition !== 'unknown',
        listing.attributes.fuelType !== 'unknown',
        listing.attributes.bodyStyle !== 'unknown',
        listing.attributes.transmission !== 'unknown',
        listing.attributes.drivetrain !== 'unknown',
        computeListingAgeDays(listing.updatedAt || listing.postedAt) !== null,
    ];

    const present = checks.filter(Boolean).length;
    return Math.round((present / checks.length) * 100);
}

function computeListingQualityScore({
    searchSignals,
    attributes,
    vehicleAge,
    listingCompleteness,
    suspiciouslyLowPrice,
    mileageMissing,
}) {
    let score = 48;

    score += Math.min(20, searchSignals.queryMatchScore * 3);
    score += Math.min(8, searchSignals.locationMatchScore * 2);
    score += Math.min(12, attributes.imageCount);
    if (attributes.hasVin) score += 8;
    if (attributes.sellerPhoneCount >= 1) score += 5;
    if (attributes.titleStatus !== 'unknown') score += 4;
    if (attributes.condition !== 'unknown') score += 4;
    if (attributes.listingAgeDays !== null && attributes.listingAgeDays <= 21) score += 4;
    if (mileageMissing) score -= vehicleAge !== null && vehicleAge <= 5 ? 8 : 18;
    if (vehicleAge === null) score -= 6;
    if (listingCompleteness < 45) score -= 10;
    if (suspiciouslyLowPrice) score -= 25;

    return Math.max(0, Math.min(100, Math.round(score)));
}

function buildLowPriceReason(priceNumeric, minimumReasonablePrice, peerMedianPrice) {
    if (peerMedianPrice !== null && priceNumeric !== null) {
        const percentBelowPeer = Math.round((1 - (priceNumeric / peerMedianPrice)) * 100);
        if (percentBelowPeer > 0) {
            return `asking price is about ${percentBelowPeer}% below similar Craigslist listings`;
        }
    }

    if (priceNumeric !== null && minimumReasonablePrice) {
        return `asking price falls below the normal floor of ${formatPrice(minimumReasonablePrice)} for this age range`;
    }

    return 'asking price is unusually low for comparable listings';
}

function formatPipelineError(query, outputTail) {
    const output = `${outputTail || ''}`.trim();

    if (/No module named ['"]dotenv['"]/.test(output)) {
        return `Craigslist pipeline failed for "${query}" because the Python environment is missing python-dotenv.`;
    }

    if (/Missing Python dependency ['"]tavily['"]/.test(output) || /No module named ['"]tavily['"]/.test(output)) {
        return `Craigslist pipeline failed for "${query}" because the Python scraper dependency "tavily" is not installed.`;
    }

    if (/TAVILY_API_KEY is not set/.test(output) || /No API key provided/i.test(output)) {
        return `Craigslist pipeline failed for "${query}" because TAVILY_API_KEY is not configured for the Python scraper.`;
    }

    if (!output) {
        return `Craigslist pipeline failed for "${query}".`;
    }

    const cleaned = output
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line) => !line.startsWith('Traceback'))
        .slice(-4)
        .join(' ');

    return `Craigslist pipeline failed for "${query}". ${cleaned}`;
}

function analyzeSearchIntent(query) {
    const rawQuery = `${query || ''}`.trim();
    const reliabilityIntent = RELIABILITY_INTENT_PATTERNS.some((pattern) => pattern.test(rawQuery));
    const vehicleQuery = reliabilityIntent ? stripReliabilityIntent(rawQuery) : rawQuery;

    return {
        rawQuery,
        vehicleQuery: vehicleQuery || rawQuery,
        reliabilityIntent,
    };
}

function stripReliabilityIntent(query) {
    const patterns = [
        /\blow maintenance\b/gi,
        /\blong[-\s]lasting\b/gi,
        /\bproblem[-\s]?free\b/gi,
        /\btrouble[-\s]?free\b/gi,
        /\bno issues\b/gi,
        /\breliability\b/gi,
        /\breliable\b/gi,
        /\bdependable\b/gi,
        /\bdurable\b/gi,
        /\bbulletproof\b/gi,
        /\btrustworthy\b/gi,
    ];

    let cleaned = `${query || ''}`;
    for (const pattern of patterns) {
        cleaned = cleaned.replace(pattern, ' ');
    }

    cleaned = cleaned
        .replace(/\b(car|cars|vehicle|vehicles)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    return cleaned;
}

function normalizeResearchData(research) {
    if (!research || typeof research !== 'object') {
        return null;
    }

    const mechanicReliabilityScore = toFiniteNumber(research.mechanic_advice?.reliability_score);
    const ownerSatisfactionScore = toFiniteNumber(research.ownership_experience?.satisfaction_score);
    const shouldBuyConfidence = toFiniteNumber(research.should_i_buy?.confidence_score);
    const highMileageConfidence = toFiniteNumber(research.high_mileage?.confidence_score);
    const researchScore = toFiniteNumber(research.research_score);
    const reliabilityScore = weightedAverage([
        [mechanicReliabilityScore, 0.55],
        [ownerSatisfactionScore, 0.2],
        [highMileageConfidence, 0.15],
        [shouldBuyConfidence, 0.1],
    ]) ?? researchScore;

    return {
        researchScore,
        reliabilityScore: reliabilityScore !== null ? Number(reliabilityScore.toFixed(1)) : null,
        verdict: research.verdict || null,
        reliabilityRating: research.mechanic_advice?.reliability_rating || 'unknown',
        shouldBuyVerdict: research.should_i_buy?.reddit_verdict || 'unknown',
        ownerSatisfaction: research.ownership_experience?.owner_satisfaction || 'unknown',
        priceVerdict: research.costs_and_value?.price_verdict || 'unknown',
        estimatedMarketValue: toFiniteNumber(research.costs_and_value?.estimated_market_value),
        knownIssues: Array.isArray(research.mechanic_advice?.known_issues)
            ? research.mechanic_advice.known_issues.slice(0, 6)
            : [],
        prePurchaseChecks: Array.isArray(research.mechanic_advice?.pre_purchase_checks)
            ? research.mechanic_advice.pre_purchase_checks.slice(0, 4)
            : [],
        summary: research.should_i_buy?.summary
            || research.mechanic_advice?.summary
            || research.ownership_experience?.summary
            || null,
        source: research.source || 'reddit',
    };
}

function computeQueryMatchScore(listing, query) {
    const tokens = tokenize(query);
    if (tokens.length === 0) return 0;

    const title = `${listing.title || ''}`.toLowerCase();
    const make = `${listing.make || ''}`.toLowerCase();
    const model = `${listing.model || ''}`.toLowerCase();
    const trim = `${listing.trim || ''}`.toLowerCase();
    const haystack = `${title} ${make} ${model} ${trim} ${listing.description || ''}`.toLowerCase();

    let score = 0;
    for (const token of tokens) {
        if (title.includes(token)) score += 3;
        else if (make === token || model === token) score += 3;
        else if (haystack.includes(token)) score += 1;
    }

    const fullPhrase = query.trim().toLowerCase();
    if (fullPhrase && title.includes(fullPhrase)) score += 4;

    return score;
}

function computeLocationMatchScore(listing, location) {
    const tokens = tokenize(location);
    if (tokens.length === 0) return 0;

    const haystack = [
        listing.location,
        listing.title,
        listing.description,
        listing.url,
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

    return tokens.reduce((score, token) => score + (haystack.includes(token) ? 2 : 0), 0);
}

function computeListingAgeDays(isoLikeDate) {
    if (!isoLikeDate) return null;
    const parsed = new Date(isoLikeDate);
    if (Number.isNaN(parsed.getTime())) return null;
    return Math.max(0, Math.round((Date.now() - parsed.getTime()) / (1000 * 60 * 60 * 24)));
}

function slugCandidates(query) {
    const normalized = sanitizeQuery(query);
    if (!normalized) return [];

    const base = normalized.replace(/\s+/g, '_');
    const compact = normalized.replace(/\s+/g, '');
    const withoutDigitBreaks = normalized.replace(/\s+(?=\d)/g, '');

    return [...new Set([base, compact, withoutDigitBreaks.replace(/\s+/g, '_')])];
}

function sanitizeQuery(query) {
    return `${query || ''}`
        .trim()
        .toLowerCase()
        .replace(/[^\w\s-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function tokenize(value) {
    return sanitizeQuery(
        `${value || ''}`
            .replace(/([a-z])(\d)/gi, '$1 $2')
            .replace(/(\d)([a-z])/gi, '$1 $2')
            .replace(/[_-]+/g, ' ')
    )
        .split(' ')
        .filter(Boolean);
}

function formatPrice(price) {
    return `$${Number(price).toLocaleString('en-US')}`;
}

function trimDescription(description) {
    return description.length > 3500
        ? `${description.slice(0, 3500)}...`
        : description;
}

function normalizeIdentifier(value) {
    const normalized = `${value ?? ''}`.trim().toLowerCase();
    return normalized || null;
}

function normalizeTitleForDedup(title) {
    const normalized = `${title || ''}`
        .toLowerCase()
        .replace(/\*\*/g, ' ')
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    return normalized || null;
}

function normalizePhoneList(phoneNumbers) {
    if (!Array.isArray(phoneNumbers) || phoneNumbers.length === 0) {
        return null;
    }

    const normalized = [...new Set(
        phoneNumbers
            .map((phone) => `${phone || ''}`.replace(/\D/g, ''))
            .filter((phone) => phone.length >= 7)
    )]
        .sort()
        .join(',');

    return normalized || null;
}

function buildImageSignature(images) {
    if (!Array.isArray(images) || images.length === 0) {
        return null;
    }

    const signature = images
        .slice(0, 3)
        .map((image) => {
            const parts = `${image || ''}`.split('/');
            return parts[parts.length - 1] || '';
        })
        .filter(Boolean)
        .join(',');

    return signature || null;
}

function toNumber(value) {
    return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function toFiniteNumber(value) {
    return Number.isFinite(Number(value)) ? Number(value) : null;
}

function weightedAverage(weightedValues) {
    let totalWeight = 0;
    let weightedSum = 0;

    for (const [value, weight] of weightedValues) {
        if (value === null || value === undefined) continue;
        totalWeight += weight;
        weightedSum += value * weight;
    }

    if (!totalWeight) return null;
    return weightedSum / totalWeight;
}
