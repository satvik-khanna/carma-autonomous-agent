'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import SearchForm from '@/components/SearchForm';
import { sortCarsByScoreDesc } from '@/lib/scoringSort';

export default function HomePage() {
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [loadingMsg, setLoadingMsg] = useState('');

    const pollForResults = async (query, formData, attempt = 0) => {
        const maxAttempts = 40;
        const pollInterval = 10000;

        if (attempt >= maxAttempts) {
            setLoading(false);
            setLoadingMsg('');
            alert('Search timed out. The pipeline may still be running — try again in a minute.');
            return;
        }

        const dots = '.'.repeat((attempt % 3) + 1);
        const elapsed = Math.round((attempt * pollInterval) / 1000);
        setLoadingMsg(`Scraping Craigslist for "${query}"${dots} (${elapsed}s)`);

        await new Promise((r) => setTimeout(r, pollInterval));

        try {
            const pollRes = await fetch(`/api/craigslist?q=${encodeURIComponent(query)}`);
            const pollData = await pollRes.json();

            if (pollData.success && pollData.listings?.length > 0) {
                await rankAndNavigate(pollData.listings, formData, pollData);
                return;
            }
        } catch {
            // keep polling
        }

        return pollForResults(query, formData, attempt + 1);
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

            // Pipeline started in background — poll for results
            if (searchData.status === 'pipeline_running') {
                pollForResults(formData.query, formData);
                return;
            }

            if (!searchRes.ok || !searchData.success) {
                throw new Error(searchData.error || 'Search failed.');
            }

            if (!searchData.listings || searchData.listings.length === 0) {
                alert('No listings found. Try a different search.');
                return;
            }

            await rankAndNavigate(searchData.listings, formData, searchData);
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
                    <h1 className="hero-title animate-fade-in-up">
                        Find Your Perfect Car,{' '}
                        <span className="gradient-text">Smarter</span>
                    </h1>
                    <p className="hero-subtitle animate-fade-in-up animate-delay-1">
                        Carma uses your team&apos;s Craigslist scraping pipeline, scores every listing from structured scraped attributes,
                        and tells you which cars are worth buying based on your budget and lifestyle.
                    </p>

                    <div className="animate-fade-in-up animate-delay-2">
                        <SearchForm onSearch={handleSearch} loading={loading} loadingMsg={loadingMsg} />
                    </div>
                </div>
            </section>

            <section id="how-it-works" style={{ padding: '5rem 0' }}>
                <div className="container">
                    <h2 style={{ textAlign: 'center', marginBottom: '3rem', fontSize: '2rem' }}>
                        How It Works
                    </h2>
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
                        gap: '2rem',
                    }}>
                        {[
                            {
                                icon: '🔍',
                                title: 'Search',
                                desc: 'Tell us what car you want, your budget, and how you plan to use it.',
                            },
                            {
                                icon: '🌐',
                                title: 'Aggregate',
                                desc: 'We load structured Craigslist listings from the backend scraping pipeline your team already built.',
                            },
                            {
                                icon: '🤖',
                                title: 'Score',
                                desc: 'Each listing is scored from scraped attributes like price, mileage, year, title, seller, and condition signals.',
                            },
                            {
                                icon: '✅',
                                title: 'Decide',
                                desc: 'Review ranked buy recommendations with explainable score breakdowns and listing links.',
                            },
                        ].map((step, i) => (
                            <div
                                key={i}
                                className="card animate-fade-in-up"
                                style={{
                                    padding: '2rem',
                                    textAlign: 'center',
                                    animationDelay: `${i * 0.15}s`,
                                    opacity: 0,
                                }}
                            >
                                <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>{step.icon}</div>
                                <h3 style={{ fontSize: '1.25rem', marginBottom: '0.75rem' }}>{step.title}</h3>
                                <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.9rem' }}>
                                    {step.desc}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>
        </>
    );
}
