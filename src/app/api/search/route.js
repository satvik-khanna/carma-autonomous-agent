import { searchCars } from '@/lib/tavily';
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function POST(request) {
    try {
        const body = await request.json();
        const { query, location, maxResults = 10 } = body;

        if (!query) {
            return NextResponse.json(
                { error: 'Search query is required' },
                { status: 400 }
            );
        }

        // ── 1. Try enriched scraped data first (Stage 5 research data) ──
        const scrapedListings = getScrapedListings(query);

        if (scrapedListings.length > 0) {
            return NextResponse.json({
                success: true,
                count: scrapedListings.length,
                listings: scrapedListings,
                query,
                source: 'scraped',
            });
        }

        // ── 2. Fall back to live Tavily search ──
        const buyListings = await searchCars({ query, location, maxResults });

        let rentalListings = [];
        if (includeRentals) {
            rentalListings = await searchRentals({
                query,
                location,
                maxResults: Math.ceil(maxResults / 2),
            });
        }

        const allListings = [
            ...buyListings.map((l) => ({ ...l, listingType: l.listingType || 'buy' })),
            ...rentalListings,
        ];

        return NextResponse.json({
            success: true,
            count: allListings.length,
            listings: allListings,
            query,
            source: 'live',
        });
    } catch (error) {
        console.error('Search API error:', error);
        return NextResponse.json(
            { error: 'Failed to search for cars. Please try again.' },
            { status: 500 }
        );
    }
}


/**
 * Load pre-scraped + research-enriched data from the pipeline.
 * Checks for enriched (Stage 5) data first, then falls back to Stage 4 data.
 */
function getScrapedListings(query) {
    try {
        const structuredDir = path.join(process.cwd(), 'backend', 'data', 'craigslist', '04_structured');
        if (!fs.existsSync(structuredDir)) return [];

        // Load ALL JSON files from structured directory
        const files = fs.readdirSync(structuredDir).filter(
            (f) => f.endsWith('.json')
        );

        if (files.length === 0) return [];

        // Load enriched files (Stage 5) AND structured files (Stage 4)
        // For cars with both, prefer the enriched version
        const enrichedFiles = files.filter((f) => f.startsWith('listings_enriched_'));
        const structuredFiles = files.filter((f) => f.startsWith('listings_structured_'));

        // Track which slugs have enriched data
        const enrichedSlugs = new Set(
            enrichedFiles.map((f) => f.replace('listings_enriched_', '').replace('.json', ''))
        );

        // Load enriched files first
        let allData = [];
        for (const file of enrichedFiles) {
            try {
                const data = JSON.parse(fs.readFileSync(path.join(structuredDir, file), 'utf-8'));
                if (Array.isArray(data)) allData = allData.concat(data);
            } catch {/* skip */ }
        }

        // Then load structured files that DON'T have enriched versions
        for (const file of structuredFiles) {
            const slug = file.replace('listings_structured_', '').replace('.json', '');
            if (enrichedSlugs.has(slug)) continue; // Already have enriched version
            try {
                const data = JSON.parse(fs.readFileSync(path.join(structuredDir, file), 'utf-8'));
                if (Array.isArray(data)) allData = allData.concat(data);
            } catch {/* skip */ }
        }

        if (allData.length === 0) return [];

        // Deduplicate by ID/URL first
        const seenIds = new Set();
        allData = allData.filter((item) => {
            const key = item.id || item.url;
            if (seenIds.has(key)) return false;
            seenIds.add(key);
            return true;
        });

        // Deduplicate by content (same price + mileage = same car posted multiple times)
        const seenContent = new Set();
        allData = allData.filter((item) => {
            const contentKey = `${item.price_usd}_${item.mileage}_${(item.title || '').substring(0, 30)}`;
            if (seenContent.has(contentKey)) return false;
            seenContent.add(contentKey);
            return true;
        });

        // Filter by query
        const q = query.toLowerCase();
        const filtered = allData.filter((item) => {
            const searchable = `${item.title} ${item.make} ${item.model} ${item.trim || ''}`.toLowerCase();
            return searchable.includes(q) || q.split(' ').some((word) => word.length > 2 && searchable.includes(word));
        });

        if (filtered.length === 0) return [];

        // Pre-sort by quality signals: price exists > newer year > lower mileage
        filtered.sort((a, b) => {
            const aHasPrice = a.price_usd ? 1 : 0;
            const bHasPrice = b.price_usd ? 1 : 0;
            if (aHasPrice !== bHasPrice) return bHasPrice - aHasPrice;
            const aYear = a.year || 0;
            const bYear = b.year || 0;
            if (aYear !== bYear) return bYear - aYear;
            const aMiles = a.mileage || 999999;
            const bMiles = b.mileage || 999999;
            return aMiles - bMiles;
        });

        // Limit to top 20 for ranking performance
        const topListings = filtered.slice(0, 20);

        // Normalize to frontend format, including research data
        return topListings.map((item) => ({
            id: item.id,
            title: item.title || `${item.year} ${item.make} ${item.model} ${item.trim || ''}`.trim(),
            price: item.price_usd ? `$${item.price_usd.toLocaleString()}` : 'Contact for Price',
            priceNumeric: item.price_usd || null,
            year: item.year,
            make: item.make,
            model: item.model,
            mileage: item.mileage,
            description: cleanDescription(item.description),
            url: item.url,
            source: 'Craigslist',
            image: item.image_urls?.[0] || null,
            listingType: 'buy',
            condition: item.condition_raw,
            transmission: item.transmission,
            fuel: item.fuel,
            drive: item.drive,
            location: item.location,
            latitude: item.latitude,
            longitude: item.longitude,
            vin: item.vin,
            // Stage 5 research data (if available)
            research: item.research || null,
        }));
    } catch {
        return [];
    }
}

function cleanDescription(desc) {
    if (!desc) return '';
    return desc
        .replace(/\[CL\].*?\n/g, '')
        .replace(/\[.*?\]\(.*?\)/g, '')
        .replace(/◀.*?▶/g, '')
        .replace(/#{1,6}\s*/g, '')
        .replace(/post id:.*$/gm, '')
        .replace(/posted:.*$/gm, '')
        .replace(/favorite\n/g, '')
        .replace(/hide\n/g, '')
        .replace(/unhide\n/g, '')
        .replace(/QR Code Link to This Post\n/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .substring(0, 500);
}
