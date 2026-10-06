import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { searchCraigslistCars } from '@/lib/craigslistPipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const JOB_TTL_MS = 15 * 60 * 1000;

// Results live only in server memory; globalThis keeps the map across dev hot reloads
const jobs = globalThis.__carmaSearchJobs || (globalThis.__carmaSearchJobs = new Map());

function pruneJobs() {
    const now = Date.now();
    for (const [id, job] of jobs) {
        if (now - job.startedAt > JOB_TTL_MS) jobs.delete(id);
    }
}

/**
 * POST /api/search — start a live Craigslist scrape for the query.
 * Returns 202 with a jobId; poll GET /api/search?job=<jobId> for results.
 */
export async function POST(request) {
    let body;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { query, location, maxMileage, maxResults = 20 } = body || {};
    if (!query || !`${query}`.trim()) {
        return NextResponse.json({ error: 'Search query is required' }, { status: 400 });
    }

    pruneJobs();

    const normalizedMaxMileage = Number.isFinite(Number(maxMileage)) && Number(maxMileage) > 0
        ? Number(maxMileage)
        : null;

    const jobId = randomUUID();
    const job = { status: 'running', query, startedAt: Date.now() };
    jobs.set(jobId, job);

    searchCraigslistCars({ query, location, maxMileage: normalizedMaxMileage, maxResults })
        .then((result) => {
            Object.assign(job, { status: 'done', ...result });
        })
        .catch((error) => {
            console.error(`Live scrape failed for "${query}":`, error.message);
            Object.assign(job, { status: 'failed', error: error.message });
        });

    return NextResponse.json({
        success: false,
        status: 'pipeline_running',
        jobId,
        query,
        message: `Scraping Craigslist live for "${query}" — this takes about a minute.`,
    }, { status: 202 });
}

/**
 * GET /api/search?job=<jobId> — check on a live scrape.
 */
export async function GET(request) {
    const jobId = new URL(request.url).searchParams.get('job');
    const job = jobId ? jobs.get(jobId) : null;

    if (!job) {
        return NextResponse.json(
            { status: 'not_found', error: 'Search expired or not found. Please search again.' },
            { status: 404 },
        );
    }

    const elapsedSeconds = Math.round((Date.now() - job.startedAt) / 1000);

    if (job.status === 'running') {
        return NextResponse.json({ status: 'pipeline_running', query: job.query, elapsedSeconds });
    }

    jobs.delete(jobId);

    if (job.status === 'failed') {
        return NextResponse.json(
            { status: 'pipeline_failed', query: job.query, error: job.error },
            { status: 500 },
        );
    }

    return NextResponse.json({
        success: true,
        status: 'done',
        query: job.query,
        count: job.listings.length,
        listings: job.listings,
        source: 'craigslist_live',
        searchContext: job.searchContext,
        elapsedSeconds,
    });
}
