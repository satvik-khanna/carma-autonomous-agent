import { rankCars } from '@/lib/openai';
import { NextResponse } from 'next/server';

export async function POST(request) {
    try {
        const body = await request.json();
        const { cars, preferences } = body;

        if (!cars || !Array.isArray(cars) || cars.length === 0) {
            return NextResponse.json(
                { error: 'Car listings array is required' },
                { status: 400 }
            );
        }

        const rankedCars = await rankCars(cars, preferences || {});

        return NextResponse.json({
            success: true,
            count: rankedCars.length,
            rankings: rankedCars,
        });
    } catch (error) {
        console.error('Rank API error:', error);
        return NextResponse.json(
            { error: 'Failed to rank cars. Please try again.' },
            { status: 500 }
        );
    }
}
