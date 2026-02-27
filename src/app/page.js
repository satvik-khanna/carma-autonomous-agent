'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import SearchForm from '@/components/SearchForm';

export default function HomePage() {
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [loadingMsg, setLoadingMsg] = useState('');

    const handleSearch = async (formData) => {
        setLoading(true);
        setLoadingMsg('🔍 Searching for the best deals...');

        try {
            // Step 1: Search for cars (scraped data or live Tavily)
            const searchRes = await fetch('/api/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    query: formData.query,
                    location: formData.location,
                    maxResults: 20,
                    includeRentals: formData.preference !== 'prefer buying',
                }),
            });

            const searchData = await searchRes.json();

            if (!searchData.success || !searchData.listings || searchData.listings.length === 0) {
                setLoading(false);
                setLoadingMsg('');
                alert('No car listings found. Try a different search.');
                return;
            }

            setLoadingMsg(`🤖 Ranking ${searchData.listings.length} listings...`);

            // Step 2: Rank the cars with our scoring engine
            const rankRes = await fetch('/api/rank', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    cars: searchData.listings,
                    preferences: {
                        budget: formData.budget,
                        useCase: formData.useCase,
                        duration: formData.duration,
                        location: formData.location,
                        preference: formData.preference,
                    },
                }),
            });

            const rankData = await rankRes.json();

            // Use ranked results, or fall back to search results if ranking fails
            const finalListings = rankData.rankings && rankData.rankings.length > 0
                ? rankData.rankings
                : searchData.listings;

            // Store results in sessionStorage for the results page
            sessionStorage.setItem(
                'carma-results',
                JSON.stringify({
                    rankings: finalListings,
                    query: formData.query,
                    preferences: formData,
                    source: searchData.source || 'unknown',
                    timestamp: new Date().toISOString(),
                })
            );

            router.push('/results');
        } catch (error) {
            console.error('Search failed:', error);
            alert('Something went wrong. Please try again.');
        } finally {
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
                        Carma scrapes Craigslist, researches reliability, and ranks every listing —
                        so you find the <strong>best deal</strong> personalized to your budget and needs.
                    </p>

                    <div className="animate-fade-in-up animate-delay-2">
                        <SearchForm onSearch={handleSearch} loading={loading} loadingMsg={loadingMsg} />
                    </div>
                </div>
            </section>

            {/* How It Works */}
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
                                desc: 'Tell us what car you\'re looking for, your budget, and how you\'ll use it.',
                            },
                            {
                                icon: '🌐',
                                title: 'Aggregate',
                                desc: 'We scrape Craigslist across Northern California to find every listing.',
                            },
                            {
                                icon: '🔬',
                                title: 'Research',
                                desc: 'Our agent researches reliability, recalls, market value, and owner reviews.',
                            },
                            {
                                icon: '✅',
                                title: 'Rank & Decide',
                                desc: 'See ranked results with buy vs rent recommendations tailored to you.',
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
