import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const DATA_DIR = path.join(
  process.cwd(),
  "backend",
  "data",
  "craigslist",
  "04_structured",
);

/**
 * Cache for loaded Craigslist listings.
 * Loaded once on first request, then reused.
 */
let cachedListings = null;

/**
 * Load all structured Craigslist listings from JSON files.
 */
function loadAllListings() {
  if (cachedListings) return cachedListings;

  const allListings = [];

  try {
    const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"));

    for (const file of files) {
      const filePath = path.join(DATA_DIR, file);
      const raw = fs.readFileSync(filePath, "utf-8");
      const listings = JSON.parse(raw);

      if (Array.isArray(listings)) {
        allListings.push(...listings);
      }
    }
  } catch (error) {
    console.error("Failed to load Craigslist data:", error);
  }

  cachedListings = allListings;
  return allListings;
}

/**
 * GET /api/craigslist?q=<search query>
 *
 * Search local Craigslist structured data for listings matching the query.
 * Returns listings with their image URLs.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q") || "";

    if (!query.trim()) {
      return NextResponse.json(
        { error: 'Query parameter "q" is required' },
        { status: 400 },
      );
    }

    const allListings = loadAllListings();

    // Tokenize query into search terms
    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 1);

    // Filter listings that match any of the search terms
    const matches = allListings.filter((listing) => {
      const searchable = [
        listing.title,
        listing.make,
        listing.model,
        listing.trim,
        listing.location,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return terms.some((term) => searchable.includes(term));
    });

    // Return slim listing objects with image data
    const results = matches.map((listing) => ({
      id: listing.id,
      title: listing.title,
      url: listing.url,
      image_urls: listing.image_urls || [],
      price_usd: listing.price_usd,
      year: listing.year,
      mileage: listing.mileage,
      make: listing.make,
      model: listing.model,
      location: listing.location,
      seller_type: listing.seller_type,
      condition_raw: listing.condition_raw,
      transmission: listing.transmission,
      drive: listing.drive,
      body_type: listing.body_type,
      paint_color: listing.paint_color,
    }));

    return NextResponse.json({
      success: true,
      count: results.length,
      listings: results,
    });
  } catch (error) {
    console.error("Craigslist API error:", error);
    return NextResponse.json(
      { error: "Failed to search Craigslist data." },
      { status: 500 },
    );
  }
}
