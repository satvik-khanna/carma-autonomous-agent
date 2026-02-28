import { searchListings } from '@/lib/aws';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

let searchCraigslistCars = null;
try {
    const mod = await import('@/lib/craigslistPipeline');
    searchCraigslistCars = mod.searchCraigslistCars;
} catch {
    // craigslistPipeline not available (e.g. on Render — no local files)
}

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

        // Try DynamoDB first (works on Render + local)
        try {
            const dynamoListings = await searchListings(query);
            if (dynamoListings.length > 0) {
                let filtered = dynamoListings;

                if (normalizedMaxMileage) {
                    filtered = filtered.filter((l) => {
                        const m = Number(l.mileage);
                        return !Number.isFinite(m) || m <= normalizedMaxMileage;
                    });
                }

                const mapped = filtered.slice(0, maxResults).map((listing) => ({
                    ...listing,
                    listingType: 'buy',
                }));

                return NextResponse.json({
                    success: true,
                    count: mapped.length,
                    listings: mapped,
                    query,
                    source: 'dynamodb',
                    searchContext: { reliabilityIntent: false, maxMileage: normalizedMaxMileage },
                });
            }
        } catch (err) {
            console.warn('DynamoDB search unavailable:', err.message);
        }

        // Fallback to local pipeline (only works in local dev)
        if (searchCraigslistCars) {
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
                source: 'local',
                searchContext,
            });
        }

        return NextResponse.json(
            { error: 'No data available. Run the pipeline first or check AWS connection.' },
            { status: 404 }
        );
    } catch (error) {
        console.error('Search API error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to search. Please try again.' },
            { status: 500 }
        );
    }
}
