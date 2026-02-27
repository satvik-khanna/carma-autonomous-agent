import { searchCars } from '@/lib/tavily';
import { NextResponse } from 'next/server';

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

        // Buy-only listing search
        const buyListings = await searchCars({ query, location, maxResults });

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
            { error: 'Failed to search for cars. Please try again.' },
            { status: 500 }
        );
    }
}
