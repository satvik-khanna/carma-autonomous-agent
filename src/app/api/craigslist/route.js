import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { searchListings, queryToSlug } from "@/lib/aws";

const DATA_DIR = path.join(
  process.cwd(),
  "backend",
  "data",
  "craigslist",
  "04_structured",
);

/**
 * Load enriched listings (with research data) first, then fall back to structured.
 * Used as fallback when DynamoDB is unavailable.
 */
function loadListingsFromDisk(queryTerms) {
  const allListings = [];

  try {
    const files = fs.readdirSync(DATA_DIR);
    const slug = queryTerms.join("_");

    // Only load files whose name contains ALL query terms
    const fileMatchesQuery = (f) =>
      queryTerms.every((term) => f.toLowerCase().includes(term));

    const enrichedFiles = files.filter(
      (f) => f.startsWith("listings_enriched_") && f.endsWith(".json") && fileMatchesQuery(f),
    );
    const structuredFiles = files.filter(
      (f) => f.startsWith("listings_structured_") && f.endsWith(".json") && fileMatchesQuery(f),
    );

    for (const file of enrichedFiles) {
      const filePath = path.join(DATA_DIR, file);
      const raw = fs.readFileSync(filePath, "utf-8");
      const listings = JSON.parse(raw);
      if (Array.isArray(listings)) {
        allListings.push(...listings);
      }
    }

    if (allListings.length === 0) {
      for (const file of structuredFiles) {
        const filePath = path.join(DATA_DIR, file);
        const raw = fs.readFileSync(filePath, "utf-8");
        const listings = JSON.parse(raw);
        if (Array.isArray(listings)) {
          allListings.push(...listings);
        }
      }
    }
  } catch (error) {
    console.error("Failed to load pipeline data from disk:", error);
  }

  return allListings;
}

/**
 * Map a pipeline listing (with research) to the format the frontend expects.
 */
function mapToFrontend(listing) {
  const research = listing.research || {};
  const researchScore = research.research_score || null;

  const shouldBuyScore = research.should_i_buy?.confidence_score || 5;
  const mechanicScore = research.mechanic_advice?.reliability_score || 5;
  const ownerScore = research.ownership_experience?.satisfaction_score || 5;
  const costVerdict = research.costs_and_value?.price_verdict || "unknown";

  let valueScore = 5;
  if (costVerdict === "below_market") valueScore = 9;
  else if (costVerdict === "fair") valueScore = 7;
  else if (costVerdict === "slightly_above") valueScore = 4;
  else if (costVerdict === "overpriced") valueScore = 2;

  const insights = [];
  if (research.verdict) {
    insights.push(research.verdict.split(".")[0]);
  }
  if (research.should_i_buy?.reddit_verdict) {
    const v = research.should_i_buy.reddit_verdict;
    if (v === "strong_buy" || v === "buy") insights.push("Reddit says: BUY");
    else if (v === "avoid" || v === "caution") insights.push("Reddit says: CAUTION");
  }
  if (research.mechanic_advice?.known_issues?.length > 0) {
    insights.push(`Watch for: ${research.mechanic_advice.known_issues.slice(0, 2).join(", ")}`);
  }
  if (research.should_i_buy?.advice?.length > 0) {
    insights.push(`"${research.should_i_buy.advice[0].substring(0, 80)}..."`);
  }

  const overallScore = researchScore || 5;
  const recommendation = overallScore >= 7 ? "buy" : "consider";

  return {
    id: listing.id,
    title: listing.title,
    url: listing.url,
    image: listing.image_urls?.[0] || null,
    imageUrls: listing.image_urls || [],
    price: listing.price_usd ? `$${Number(listing.price_usd).toLocaleString()}` : null,
    priceNumeric: listing.price_usd,
    year: listing.year,
    mileage: listing.mileage,
    make: listing.make,
    model: listing.model,
    description: listing.description || "",
    source: "Craigslist",
    location: listing.location || null,
    latitude: listing.latitude,
    longitude: listing.longitude,
    condition: listing.condition_raw,
    transmission: listing.transmission,
    fuel: listing.fuel,
    drive: listing.drive,
    body_type: listing.body_type,
    paint_color: listing.paint_color,
    title_status: listing.title_status,
    seller_type: listing.seller_type,
    vin: listing.vin,
    listingType: "buy",
    fetchedAt: listing.extracted_at || new Date().toISOString(),

    overallScore: Math.round(overallScore),
    valueScore: valueScore,
    conditionScore: mechanicScore,
    buyScore: shouldBuyScore,
    matchScore: ownerScore,
    recommendation: recommendation,
    aiExplanation: insights.length > 0
      ? insights.slice(0, 3).join(". ") + "."
      : "Run pipeline Stage 5 for Reddit research insights.",

    research: research,
  };
}

/**
 * GET /api/craigslist?q=<search query>
 *
 * Tries DynamoDB first (cloud), falls back to local pipeline files.
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

    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 1);

    let allListings = [];
    let dataSource = "local";

    // Try DynamoDB first
    try {
      const dynamoListings = await searchListings(query);
      if (dynamoListings.length > 0) {
        allListings = dynamoListings;
        dataSource = "dynamodb";
        console.log(`DynamoDB hit: ${allListings.length} listings for "${query}"`);
      }
    } catch (err) {
      console.warn("DynamoDB unavailable, falling back to local:", err.message);
    }

    // Fallback to local files
    if (allListings.length === 0) {
      allListings = loadListingsFromDisk(terms);
      dataSource = "local";
    }

    // Filter by query terms
    const matches = allListings.filter((listing) => {
      const searchable = [
        listing.title,
        listing.make,
        listing.model,
        listing.trim,
        listing.location,
        String(listing.year || ""),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return terms.every((term) => searchable.includes(term));
    });

    const results = matches
      .map(mapToFrontend)
      .sort((a, b) => (b.overallScore || 0) - (a.overallScore || 0));

    const hasResearch = results.some((r) => r.research?.research_score);

    return NextResponse.json({
      success: true,
      count: results.length,
      hasResearch: hasResearch,
      source: dataSource,
      listings: results,
    });
  } catch (error) {
    console.error("Pipeline data API error:", error);
    return NextResponse.json(
      { error: "Failed to load pipeline data." },
      { status: 500 },
    );
  }
}
