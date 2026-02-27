import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

/**
 * GET /api/listings — Serve car listings from the DB (local JSON or DynamoDB).
 * Searches local JSON DB first, falls back to raw scraped data.
 */
export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const query = searchParams.get('q') || '';
        const minPrice = parseInt(searchParams.get('minPrice')) || 0;
        const maxPrice = parseInt(searchParams.get('maxPrice')) || Infinity;
        const minYear = parseInt(searchParams.get('minYear')) || 0;
        const maxMileage = parseInt(searchParams.get('maxMileage')) || Infinity;
        const make = searchParams.get('make') || '';
        const model = searchParams.get('model') || '';
        const sortBy = searchParams.get('sort') || 'price_asc';

        // Try local JSON DB first (populated by stage_05_load_db.py)
        let listings = loadFromJsonDb();

        // Fall back to raw scraped data
        if (listings.length === 0) {
            listings = loadFromScrapedData();
        }

        if (listings.length === 0) {
            return NextResponse.json({
                success: false,
                error: 'No listings in database. Run the scraper pipeline first.',
                count: 0,
                listings: [],
            });
        }

        // Apply filters
        if (query) {
            const q = query.toLowerCase();
            listings = listings.filter(
                (car) =>
                    car.title?.toLowerCase().includes(q) ||
                    car.make?.toLowerCase().includes(q) ||
                    car.model?.toLowerCase().includes(q) ||
                    car.trim?.toLowerCase().includes(q) ||
                    car.description?.toLowerCase().includes(q)
            );
        }
        if (make) {
            listings = listings.filter((c) => c.make?.toLowerCase() === make.toLowerCase());
        }
        if (model) {
            listings = listings.filter((c) => c.model?.toLowerCase().includes(model.toLowerCase()));
        }
        if (minPrice > 0) {
            listings = listings.filter((c) => c.priceNumeric && c.priceNumeric >= minPrice);
        }
        if (maxPrice < Infinity) {
            listings = listings.filter((c) => c.priceNumeric && c.priceNumeric <= maxPrice);
        }
        if (minYear > 0) {
            listings = listings.filter((c) => c.year && c.year >= minYear);
        }
        if (maxMileage < Infinity) {
            listings = listings.filter((c) => c.mileage && c.mileage <= maxMileage);
        }

        // Sort
        switch (sortBy) {
            case 'price_asc':
                listings.sort((a, b) => (a.priceNumeric || Infinity) - (b.priceNumeric || Infinity));
                break;
            case 'price_desc':
                listings.sort((a, b) => (b.priceNumeric || 0) - (a.priceNumeric || 0));
                break;
            case 'year_desc':
                listings.sort((a, b) => (b.year || 0) - (a.year || 0));
                break;
            case 'mileage_asc':
                listings.sort((a, b) => (a.mileage || Infinity) - (b.mileage || Infinity));
                break;
        }

        return NextResponse.json({
            success: true,
            count: listings.length,
            listings,
        });
    } catch (error) {
        console.error('Listings API error:', error);
        return NextResponse.json(
            { error: 'Failed to load listings.' },
            { status: 500 }
        );
    }
}

/**
 * Load from the local JSON DB (populated by stage_05_load_db.py).
 */
function loadFromJsonDb() {
    try {
        const dbPath = path.join(process.cwd(), 'backend', 'data', 'db', 'listings.json');
        if (!fs.existsSync(dbPath)) return [];

        const rawData = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
        const listings = Object.values(rawData);

        return listings.map(normalizeListing);
    } catch {
        return [];
    }
}

/**
 * Fall back to raw scraped data from stage 4.
 */
function loadFromScrapedData() {
    try {
        const dataPath = path.join(
            process.cwd(), 'backend', 'data', 'craigslist', '04_structured', 'listings_structured.json'
        );
        if (!fs.existsSync(dataPath)) return [];

        const rawData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
        return rawData.map(normalizeListing);
    } catch {
        return [];
    }
}

/**
 * Normalize a listing into the frontend format.
 */
function normalizeListing(item) {
    return {
        id: item.id,
        title: item.title || `${item.year || ''} ${item.make || ''} ${item.model || ''} ${item.trim || ''}`.trim(),
        price: item.price_usd ? `$${Number(item.price_usd).toLocaleString()}` : 'Contact for Price',
        priceNumeric: item.price_usd || null,
        year: item.year,
        make: item.make,
        model: item.model,
        trim: item.trim,
        mileage: item.mileage,
        description: item.description || '',
        url: item.url,
        source: capitalize(item.source),
        image: (item.image_urls || [])[0] || null,
        images: item.image_urls || [],
        listingType: 'buy',
        condition: item.condition || item.condition_raw,
        transmission: item.transmission,
        fuel: item.fuel,
        drive: item.drive,
        bodyType: item.body_type,
        color: item.paint_color,
        titleStatus: item.title_status,
        location: item.location,
        vin: item.vin,
    };
}

function capitalize(s) {
    if (!s) return 'Unknown';
    return s.charAt(0).toUpperCase() + s.slice(1);
}
