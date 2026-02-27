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

    const listings = response.results.map(normalizeResult);
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
    searchStr += ' price mileage year';
    return searchStr;
}

/**
 * Normalize a Tavily search result into a common car listing format.
 */
function normalizeResult(result, index) {
    const { title, url, content } = result;

    // Extract source from URL
    let source = 'Unknown';
    try {
        const hostname = new URL(url).hostname.replace('www.', '');
        source = hostname.split('.')[0];
        source = source.charAt(0).toUpperCase() + source.slice(1);
    } catch { }

    // Try to extract price from content
    const priceMatch = content?.match(/\$[\d,]+/);
    const price = priceMatch ? priceMatch[0] : null;

    // Try to extract year
    const yearMatch = title?.match(/(20\d{2}|19\d{2})/);
    const year = yearMatch ? parseInt(yearMatch[1]) : null;

    // Try to extract mileage
    const mileageMatch = content?.match(/([\d,]+)\s*(mi|miles|k miles)/i);
    const mileage = mileageMatch ? mileageMatch[1].replace(',', '') : null;

    return {
        id: `car-${Date.now()}-${index}`,
        title: title || 'Unknown Vehicle',
        price,
        priceNumeric: price ? parseInt(price.replace(/[$,]/g, '')) : null,
        year,
        mileage: mileage ? parseInt(mileage) : null,
        description: content || '',
        url,
        source,
        image: null, // Tavily doesn't always return images
        fetchedAt: new Date().toISOString(),
    };
}

/**
 * Search for rental car options.
 */
export async function searchRentals({ query, location, maxResults = 10 }) {
    const searchQuery = `${query} car rental lease monthly ${location || ''}`.trim();

    const response = await client.search(searchQuery, {
        searchDepth: 'advanced',
        maxResults,
        includeDomains: [
            'enterprise.com',
            'hertz.com',
            'turo.com',
            'cars.com',
            'autotrader.com',
        ],
        includeAnswer: true,
    });

    return response.results.map((result, i) => ({
        ...normalizeResult(result, i),
        listingType: 'rental',
    }));
}
