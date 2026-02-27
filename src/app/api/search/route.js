import { searchCars, searchRentals } from '@/lib/tavily';
import { NextResponse } from 'next/server';

export async function POST(request) {
    try {
        const body = await request.json();
        const { query, location, maxResults = 10, includeRentals = false } = body;

        if (!query) {
            return NextResponse.json(
                { error: 'Search query is required' },
                { status: 400 }
            );
        }

        // Search for purchase listings
        const buyListings = await searchCars({ query, location, maxResults });

        // Optionally search for rental listings
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
        });
    } catch (error) {
        console.error('Search API error:', error);
        return NextResponse.json(
            { error: 'Failed to search for cars. Please try again.' },
            { status: 500 }
        );
    }
}
