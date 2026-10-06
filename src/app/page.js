'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import SearchForm from '@/components/SearchForm';
import { sortCarsByScoreDesc } from '@/lib/scoringSort';

export default function HomePage() {
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [loadingMsg, setLoadingMsg] = useState('');

    const failSearch = (message) => {
        setLoading(false);
        setLoadingMsg('');
        alert(message);
    };

    const pollForResults = async (jobId, query, formData) => {
        const pollInterval = 4000;
        const maxWaitMs = 7 * 60 * 1000;
        const started = Date.now();

        while (Date.now() - started < maxWaitMs) {
            const elapsed = Math.round((Date.now() - started) / 1000);
            setLoadingMsg(`Scraping Craigslist live for "${query}"... (${elapsed}s)`);
            await new Promise((r) => setTimeout(r, pollInterval));

            let data;
            try {
                const res = await fetch(`/api/search?job=${encodeURIComponent(jobId)}`);
                data = await res.json();
            } catch {
                continue;
            }

            if (data.status === 'pipeline_running') continue;

            if (data.status === 'done') {
                if (!data.listings?.length) {
                    failSearch(`No Craigslist listings found for "${query}". Try a different search.`);
                    return;
                }
                await rankAndNavigate(data.listings, formData, data);
                return;
            }

            failSearch(data.error || 'Scraping failed. Please try again.');
            return;
        }

        failSearch('Scraping is taking too long. Please try again.');
    };

    const rankAndNavigate = async (listings, formData, searchData) => {
        setLoadingMsg(`Ranking ${listings.length} listings...`);

        const rankRes = await fetch('/api/rank', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                cars: listings,
                preferences: {
                    budget: formData.budget,
                    maxMileage: formData.maxMileage,
                    useCase: formData.useCase,
                    duration: formData.duration,
                    location: formData.location,
                    reliabilityIntent: Boolean(searchData.searchContext?.reliabilityIntent),
                },
            }),
        });

        const rankData = await rankRes.json();
        const rankedListings = sortCarsByScoreDesc(rankData.rankings || listings);

        sessionStorage.setItem(
            'carma-results',
            JSON.stringify({
                rankings: rankedListings,
                query: formData.query,
                preferences: formData,
                source: searchData.source || 'pipeline',
                searchContext: searchData.searchContext || null,
                timestamp: new Date().toISOString(),
            })
        );

        setLoading(false);
        setLoadingMsg('');
        router.push('/results');
    };

    const handleSearch = async (formData) => {
        setLoading(true);
        setLoadingMsg('Searching Craigslist listings...');

        try {
            const searchRes = await fetch('/api/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    query: formData.query,
                    location: formData.location,
                    maxMileage: Number(formData.maxMileage),
                    maxResults: 20,
                }),
            });

            const searchData = await searchRes.json();

            if (searchData.status !== 'pipeline_running' || !searchData.jobId) {
                throw new Error(searchData.error || 'Search failed.');
            }

            await pollForResults(searchData.jobId, formData.query, formData);
        } catch (error) {
            console.error('Search failed:', error);
            alert(error.message || 'Something went wrong. Please try again.');
            setLoading(false);
            setLoadingMsg('');
        }
    };

    return (
        <>
            <section className="hero">
                <div className="container">
                    <p className="hero-eyebrow">Bay Area · Sacramento · Central Valley</p>
                    <h1 className="hero-title">
                        Used cars on Craigslist, <em>minus the scrolling.</em>
                    </h1>
                    <p className="hero-lede">
                        Type the car you want. Carma pulls every current Craigslist listing for it,
                        drops the ones with no price or a too-good-to-be-true price, and ranks the
                        rest against your budget and how you&apos;ll actually drive it.
                    </p>

                    <SearchForm onSearch={handleSearch} loading={loading} loadingMsg={loadingMsg} />
                </div>
            </section>

            <section id="how" className="container notes">
                <h2>How the ranking works</h2>
                <ol className="notes-list">
                    <li>
                        <strong>It searches live, every time.</strong>
                        Nothing is cached, so links point to ads that are up right now. That&apos;s
                        also why a search takes a minute.
                    </li>
                    <li>
                        <strong>Junk gets filtered out.</strong>
                        Listings without a price, or priced way under similar cars nearby, don&apos;t
                        make the list. Duplicates of the same car are merged.
                    </li>
                    <li>
                        <strong>Every car gets a score out of 10.</strong>
                        It weighs price against comparable listings, mileage for the year, title
                        status, and how complete the ad is, then checks it against your budget.
                    </li>
                    <li>
                        <strong>It doesn&apos;t replace a test drive.</strong>
                        Scores are only as good as what the seller wrote. Get a pre-purchase
                        inspection before you hand over cash.
                    </li>
                </ol>
            </section>
        </>
    );
}
