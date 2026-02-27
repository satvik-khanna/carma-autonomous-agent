import { NextResponse } from 'next/server';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

/**
 * POST /api/pipeline
 * Triggers the Python scraping pipeline for a given car query.
 * This runs stages 1-5: search → parse → scrape → structure → research.
 *
 * Body: { query: "Toyota Supra", stages: [1,2,3,4,5] }
 * Returns: { success: true, listings: [...], stats: {...} }
 */
export async function POST(request) {
    try {
        const body = await request.json();
        const { query, stages } = body;

        if (!query) {
            return NextResponse.json(
                { error: 'Car query is required' },
                { status: 400 }
            );
        }

        // Paths
        const projectRoot = process.cwd();
        const pipelineDir = path.join(projectRoot, 'backend', 'scraper', 'pipeline');
        const structuredDir = path.join(projectRoot, 'backend', 'data', 'craigslist', '04_structured');

        // Build the command
        const stagesArg = stages ? `--stages ${stages.join(' ')}` : '';
        const cmd = `python run_pipeline.py "${query}" ${stagesArg}`.trim();

        console.log(`🚀 Running pipeline: ${cmd}`);

        // Run the pipeline
        const tavilyKey = process.env.TAVILY_API_KEY;
        if (!tavilyKey) {
            return NextResponse.json(
                { error: 'TAVILY_API_KEY not set in environment' },
                { status: 500 }
            );
        }

        const output = execSync(cmd, {
            cwd: pipelineDir,
            env: {
                ...process.env,
                CAR_QUERY: query,
                TAVILY_API_KEY: tavilyKey,
                PATH: process.env.PATH,
                HOME: process.env.HOME,
            },
            timeout: 300000, // 5 minute timeout
            maxBuffer: 10 * 1024 * 1024, // 10MB buffer
            encoding: 'utf-8',
        });

        console.log('Pipeline output:', output.slice(-500));

        // Read the enriched results
        const slug = query.trim().toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '_');
        const enrichedPath = path.join(structuredDir, `listings_enriched_${slug}.json`);
        const structuredPath = path.join(structuredDir, `listings_structured_${slug}.json`);

        let listings = [];
        const filePath = fs.existsSync(enrichedPath) ? enrichedPath : structuredPath;

        if (fs.existsSync(filePath)) {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            if (Array.isArray(data)) {
                listings = data;
            }
        }

        return NextResponse.json({
            success: true,
            query,
            count: listings.length,
            listings,
            pipelineOutput: output.slice(-1000), // Last 1000 chars of output
        });
    } catch (error) {
        console.error('Pipeline error:', error.message);

        // Check if it's a timeout
        if (error.killed) {
            return NextResponse.json(
                { error: 'Pipeline timed out (3 min limit). Try a less common car.' },
                { status: 504 }
            );
        }

        return NextResponse.json(
            {
                error: 'Pipeline failed: ' + (error.stderr?.slice(-300) || error.message),
            },
            { status: 500 }
        );
    }
}
