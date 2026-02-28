import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  PutCommand,
  BatchWriteCommand,
} from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION || "us-east-2";
const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || "carma-listings";

const rawClient = new DynamoDBClient({
  region: REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const dynamo = DynamoDBDocumentClient.from(rawClient, {
  marshallOptions: { removeUndefinedValues: true },
});

/**
 * Query all listings for a search slug (e.g. "2014_toyota_camry").
 * Returns enriched items first, then structured, plus any scout-discovered listings.
 */
export async function queryListingsBySlug(slug) {
  const result = await dynamo.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "pk = :pk",
      FilterExpression: "data_type IN (:enriched, :structured, :scout)",
      ExpressionAttributeValues: {
        ":pk": slug,
        ":enriched": "enriched",
        ":structured": "structured",
        ":scout": "scout",
      },
    }),
  );

  const items = result.Items || [];

  const enriched = items.filter((i) => i.data_type === "enriched");
  const scout = items.filter((i) => i.data_type === "scout");
  const structured = items.filter((i) => i.data_type === "structured");

  // Prefer enriched, combine with any new scout findings
  const primary = enriched.length > 0 ? enriched : structured;
  return [...primary, ...scout];
}

/**
 * Query research data for a search slug.
 */
export async function queryResearch(slug) {
  const result = await dynamo.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "pk = :pk AND sk = :sk",
      ExpressionAttributeValues: {
        ":pk": slug,
        ":sk": `_research_${slug}`,
      },
    }),
  );
  return result.Items?.[0] || null;
}

/**
 * Write a single listing to DynamoDB.
 */
export async function putListing(slug, listing) {
  await dynamo.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        pk: slug,
        sk: listing.id || listing.url,
        data_type: listing.research ? "enriched" : "structured",
        uploaded_at: new Date().toISOString(),
        ...listing,
      },
    }),
  );
}

/**
 * Batch write multiple listings for a slug.
 */
export async function batchPutListings(slug, listings) {
  const chunks = [];
  for (let i = 0; i < listings.length; i += 25) {
    chunks.push(listings.slice(i, i + 25));
  }

  for (const chunk of chunks) {
    await dynamo.send(
      new BatchWriteCommand({
        RequestItems: {
          [TABLE_NAME]: chunk.map((listing) => ({
            PutRequest: {
              Item: {
                pk: slug,
                sk: listing.id || listing.url,
                data_type: listing.research ? "enriched" : "structured",
                uploaded_at: new Date().toISOString(),
                ...listing,
              },
            },
          })),
        },
      }),
    );
  }
}

/**
 * Convert a user query like "2014 toyota camry" to a DynamoDB slug: "2014_toyota_camry"
 */
export function queryToSlug(query) {
  return query
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

/**
 * Try multiple slug variations to find matching listings.
 * Handles queries like "toyota camry" matching slug "2014_toyota_camry".
 */
export async function searchListings(query) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const directSlug = queryToSlug(query);

  // Try exact slug match first
  let listings = await queryListingsBySlug(directSlug);
  if (listings.length > 0) return listings;

  // Try without year prefix (e.g. "toyota_camry" from "2014 toyota camry")
  const withoutYear = terms.filter((t) => !/^\d{4}$/.test(t));
  if (withoutYear.length < terms.length) {
    const slugNoYear = withoutYear.join("_");
    listings = await queryListingsBySlug(slugNoYear);
    if (listings.length > 0) return listings;
  }

  return [];
}
