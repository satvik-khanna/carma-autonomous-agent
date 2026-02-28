import { searchCraigslistCars } from '@/lib/craigslistPipeline';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
    try {
        const body = await request.json();
        const { query, location, maxMileage, maxResults = 10 } = body;

        if (!query) {
            return NextResponse.json(
                { error: 'Search query is required' },
                { status: 400 }
            );
        }

        const normalizedMaxMileage = Number.isFinite(Number(maxMileage)) && Number(maxMileage) > 0
            ? Number(maxMileage)
            : null;

        // Buy-only search backed by the Craigslist scraping pipeline.
        const { listings: buyListings, searchContext } = await searchCraigslistCars({
            query,
            location,
            maxMileage: normalizedMaxMileage,
            maxResults,
        });

        const allListings = buyListings.map((listing) => ({
            ...listing,
            listingType: 'buy',
        }));

        return NextResponse.json({
            success: true,
            count: allListings.length,
            listings: allListings,
            query,
            searchContext,
        });
    } catch (error) {
        console.error('Search API error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to search Craigslist pipeline data. Please try again.' },
            { status: 500 }
        );
    }
}
