import { searchListings } from '@/lib/aws';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const IS_CLOUD = Boolean(process.env.RENDER || process.env.VERCEL || process.env.NODE_ENV === 'production');

let searchCraigslistCars = null;
if (!IS_CLOUD) {
    try {
        const mod = await import('@/lib/craigslistPipeline');
        searchCraigslistCars = mod.searchCraigslistCars;
    } catch {
        // craigslistPipeline not available
    }
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

        // Fallback to local pipeline (local dev only — never on Render)
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

        // No data in DynamoDB and no local pipeline available
        const availableCars = [
            'toyota camry', '2014 toyota camry', 'honda accord',
            'bmw 330i', 'infiniti q50', 'lexus is350', 'toyota supra',
        ];
        return NextResponse.json({
            success: false,
            error: `No listings found for "${query}". Available searches: ${availableCars.join(', ')}. Run the pipeline locally to add more cars.`,
            availableSearches: availableCars,
        }, { status: 404 });
    } catch (error) {
        console.error('Search API error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to search. Please try again.' },
            { status: 500 }
        );
    }
}
