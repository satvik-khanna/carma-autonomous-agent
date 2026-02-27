import { searchCraigslistCars } from '@/lib/craigslistPipeline';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

        // Buy-only search backed by the Craigslist scraping pipeline.
        const buyListings = await searchCraigslistCars({ query, location, maxResults });

        const allListings = buyListings.map((listing) => ({
            ...listing,
            listingType: 'buy',
        }));

        return NextResponse.json({
            success: true,
            count: allListings.length,
            listings: allListings,
            query,
        });
    } catch (error) {
        console.error('Search API error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to search Craigslist pipeline data. Please try again.' },
            { status: 500 }
        );
    }
}
