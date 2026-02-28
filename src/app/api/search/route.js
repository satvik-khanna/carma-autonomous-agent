import { searchListings, queryToSlug } from '@/lib/aws';
import { NextResponse } from 'next/server';
import { spawn, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const activePipelines = new Set();

let pythonAvailable = null;

function checkPython() {
    if (pythonAvailable !== null) return pythonAvailable;
    try {
        execSync('python3 --version', { stdio: 'ignore', timeout: 5000 });
        pythonAvailable = true;
    } catch {
        pythonAvailable = false;
    }
    return pythonAvailable;
}

function schedulePipeline(query) {
    setTimeout(() => {
        try {
            startBackgroundPipeline(query);
        } catch (err) {
            console.error(`Pipeline schedule error for "${query}":`, err.message);
        }
    }, 100);
}

function startBackgroundPipeline(query) {
    const slug = queryToSlug(query);
    if (activePipelines.has(slug)) return;

    if (!checkPython()) {
        console.warn('python3 not available — pipeline cannot run on this host');
        return;
    }

    const pipelineScript = path.join(process.cwd(), 'backend', 'scraper', 'pipeline', 'run_pipeline.py');
    if (!fs.existsSync(pipelineScript)) {
        console.warn(`Pipeline script not found: ${pipelineScript}`);
        return;
    }

    activePipelines.add(slug);

    const child = spawn('python3', [pipelineScript, query], {
        cwd: path.join(process.cwd(), 'backend', 'scraper', 'pipeline'),
        env: { ...process.env, CAR_QUERY: query },
        stdio: 'ignore',
        detached: true,
    });

    child.on('error', (err) => {
        console.error(`Pipeline spawn error for "${query}":`, err.message);
        activePipelines.delete(slug);
    });

    child.unref();

    child.on('close', (code) => {
        activePipelines.delete(slug);
        console.log(`Pipeline finished for "${query}" (exit code: ${code})`);
    });

    console.log(`Pipeline started in background for "${query}" (pid: ${child.pid})`);
}

export async function POST(request) {
    try {
        const body = await request.json();
        const { query, location, maxMileage, maxResults = 20 } = body;

        if (!query) {
            return NextResponse.json(
                { error: 'Search query is required' },
                { status: 400 }
            );
        }

        const normalizedMaxMileage = Number.isFinite(Number(maxMileage)) && Number(maxMileage) > 0
            ? Number(maxMileage)
            : null;

        // 1) Check DynamoDB for cached results
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
            console.warn('DynamoDB lookup skipped:', err.message);
        }

        // 2) No cached data — tell frontend to poll, then kick off pipeline after response
        const slug = queryToSlug(query);
        const alreadyRunning = activePipelines.has(slug);
        const hasPython = checkPython();

        if (!alreadyRunning && hasPython) {
            schedulePipeline(query);
        }

        const message = !hasPython
            ? `No cached data for "${query}". Pipeline unavailable on this host — run it locally and data will sync via AWS.`
            : alreadyRunning
                ? `Still scraping listings for "${query}"... check back in a moment.`
                : `Scraping Craigslist for "${query}" — this takes 2-3 minutes. Results will appear automatically.`;

        return NextResponse.json({
            success: false,
            status: hasPython ? 'pipeline_running' : 'pipeline_unavailable',
            message,
            query,
            pollUrl: `/api/craigslist?q=${encodeURIComponent(query)}`,
        }, { status: 202 });
    } catch (error) {
        console.error('Search API error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to search. Please try again.' },
            { status: 500 }
        );
    }
}
