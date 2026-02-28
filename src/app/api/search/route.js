import { searchListings, queryToSlug } from '@/lib/aws';
import { NextResponse } from 'next/server';
import { spawn, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 'running' | 'done' | 'failed'
const pipelineStatus = new Map();

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
            pipelineStatus.set(queryToSlug(query), 'failed');
        }
    }, 100);
}

function startBackgroundPipeline(query) {
    const slug = queryToSlug(query);
    if (pipelineStatus.get(slug) === 'running') return;

    if (!checkPython()) {
        console.warn('python3 not available — pipeline cannot run on this host');
        return;
    }

    const pipelineScript = path.join(process.cwd(), 'backend', 'scraper', 'pipeline', 'run_pipeline.py');
    if (!fs.existsSync(pipelineScript)) {
        console.warn(`Pipeline script not found: ${pipelineScript}`);
        return;
    }

    pipelineStatus.set(slug, 'running');

    const logFile = path.join(process.cwd(), 'backend', 'data', `pipeline_${slug}.log`);
    const logFd = fs.openSync(logFile, 'w');

    const child = spawn('python3', [pipelineScript, query], {
        cwd: path.join(process.cwd(), 'backend', 'scraper', 'pipeline'),
        env: { ...process.env, CAR_QUERY: query },
        stdio: ['ignore', logFd, logFd],
        detached: true,
    });

    child.on('error', (err) => {
        console.error(`Pipeline spawn error for "${query}":`, err.message);
        pipelineStatus.set(slug, 'failed');
        try { fs.closeSync(logFd); } catch {}
    });

    child.unref();

    child.on('close', (code) => {
        try { fs.closeSync(logFd); } catch {}
        if (code === 0) {
            pipelineStatus.set(slug, 'done');
            console.log(`Pipeline finished for "${query}"`);
        } else {
            pipelineStatus.set(slug, 'failed');
            console.error(`Pipeline FAILED for "${query}" (exit code: ${code}) — see ${logFile}`);
        }
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
        const status = pipelineStatus.get(slug);
        const hasPython = checkPython();

        if (!hasPython) {
            return NextResponse.json({
                success: false,
                status: 'pipeline_unavailable',
                message: `No cached data for "${query}". Pipeline unavailable on this host — run it locally and data will sync via AWS.`,
                query,
            }, { status: 202 });
        }

        if (status === 'failed') {
            pipelineStatus.delete(slug);
            return NextResponse.json({
                success: false,
                status: 'pipeline_failed',
                message: `Pipeline failed for "${query}". Check logs and try again.`,
                query,
            }, { status: 500 });
        }

        if (status !== 'running') {
            schedulePipeline(query);
        }

        return NextResponse.json({
            success: false,
            status: 'pipeline_running',
            message: status === 'running'
                ? `Still scraping listings for "${query}"... check back in a moment.`
                : `Scraping Craigslist for "${query}" — this takes 1-2 minutes. Results will appear automatically.`,
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
