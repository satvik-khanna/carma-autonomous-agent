'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import CarCard from '@/components/CarCard';
import { sortCarsByScoreDesc } from '@/lib/scoringSort';

export default function ResultsPage() {
    const router = useRouter();
    const [results, setResults] = useState(null);
    const [filterRecommendation, setFilterRecommendation] = useState('all');
    const [selectedCar, setSelectedCar] = useState(null);
    const [selectedImageIndex, setSelectedImageIndex] = useState(0);
    const [sortBy, setSortBy] = useState('overallScore');

    useEffect(() => {
        const stored = sessionStorage.getItem('carma-results');
        if (stored) {
            setResults(JSON.parse(stored));
        }
    }, []);

    if (!results) {
        return (
            <div className="loading-container" style={{ minHeight: '80vh', paddingTop: '8rem' }}>
                <div className="loading-spinner" />
                <p className="loading-text">Loading results...</p>
                <button className="btn btn-secondary" onClick={() => router.push('/')}>
                    ← Back to Search
                </button>
            </div>
        );
    }

    let cars = [...(results.rankings || [])];

    if (filterRecommendation !== 'all') {
        cars = cars.filter((c) => c.recommendation === filterRecommendation);
    }

    if (sortBy === 'overallScore') {
        cars = sortCarsByScoreDesc(cars);
    } else {
        cars = [...cars].sort((a, b) => {
            const left = Number(a?.[sortBy]);
            const right = Number(b?.[sortBy]);
            if (Number.isFinite(left) && Number.isFinite(right) && right !== left) {
                return right - left;
            }
            return 0;
        });
    }

    const closeModal = () => {
        setSelectedCar(null);
        setSelectedImageIndex(0);
    };

    return (
        <div className="container">
            <div className="results-header">
                <h2>
                    Results for &quot;<span style={{ color: 'var(--color-accent-secondary)' }}>{results.query}</span>&quot;
                </h2>
                <p className="results-meta">
                    {cars.length} Craigslist listings found · Highest score first · Searched at{' '}
                    {new Date(results.timestamp).toLocaleTimeString()}
                </p>
                {results.searchContext?.reliabilityIntent ? (
                    <p className="results-meta" style={{ marginTop: '0.5rem' }}>
                        {results.searchContext.researchApplied
                            ? 'Reddit reliability research was applied to re-score and re-rank these listings.'
                            : 'Reliability intent was detected, but Reddit research was unavailable, so the ranking fell back to listing-only signals.'}
                    </p>
                ) : null}

                <div style={{
                    display: 'flex',
                    gap: '1rem',
                    marginTop: '1.5rem',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                }}>
                    <div className="input-group" style={{ minWidth: '180px' }}>
                        <label htmlFor="sortBy">Sort By</label>
                        <select
                            id="sortBy"
                            className="input"
                            value={sortBy}
                            onChange={(e) => setSortBy(e.target.value)}
                        >
                            <option value="overallScore">Overall Score</option>
                            <option value="valueScore">Value Score</option>
                            <option value="buyScore">Buy Score</option>
                            <option value="matchScore">Match Score</option>
                            <option value="reliabilityScore">Reliability Score</option>
                        </select>
                    </div>

                    <div className="input-group" style={{ minWidth: '180px' }}>
                        <label htmlFor="filter">Filter</label>
                        <select
                            id="filter"
                            className="input"
                            value={filterRecommendation}
                            onChange={(e) => setFilterRecommendation(e.target.value)}
                        >
                            <option value="all">All Results</option>
                            <option value="buy">🟢 Great Deal</option>
                            <option value="consider">🟡 Consider</option>
                        </select>
                    </div>

                    <div style={{ marginLeft: 'auto' }}>
                        <button className="btn btn-secondary" onClick={() => router.push('/')}>
                            ← New Search
                        </button>
                    </div>
                </div>
            </div>

            <div className="results-grid">
                {cars.map((car, index) => (
                    <div
                        key={car.id || index}
                        className="animate-fade-in-up"
                        style={{ animationDelay: `${index * 0.08}s`, opacity: 0 }}
                    >
                        <CarCard
                            car={car}
                            rank={index + 1}
                            onClick={(c) => {
                                setSelectedCar(c);
                                setSelectedImageIndex(0);
                            }}
                        />
                    </div>
                ))}
            </div>

            {cars.length === 0 ? (
                <div style={{
                    textAlign: 'center',
                    padding: '4rem 0',
                    color: 'var(--color-text-secondary)',
                }}>
                    <p style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>No cars match your filter</p>
                    <button className="btn btn-primary" onClick={() => setFilterRecommendation('all')}>
                        Show All Results
                    </button>
                </div>
            ) : null}

            {selectedCar ? (
                <div
                    style={{
                        position: 'fixed',
                        inset: 0,
                        zIndex: 200,
                        background: 'rgba(0,0,0,0.7)',
                        backdropFilter: 'blur(8px)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '2rem',
                    }}
                    onClick={closeModal}
                >
                    <div
                        className="card"
                        style={{
                            maxWidth: '640px',
                            width: '100%',
                            maxHeight: '80vh',
                            overflow: 'auto',
                            padding: '2rem',
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
                            <div>
                                <h3 style={{ fontSize: '1.5rem', marginBottom: '0.25rem' }}>{selectedCar.title}</h3>
                                <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem' }}>
                                    {selectedCar.source} · {selectedCar.year || 'N/A'}
                                    {selectedCar.mileage ? ` · ${Number(selectedCar.mileage).toLocaleString()} miles` : ''}
                                    {selectedCar.location ? ` · ${selectedCar.location}` : ''}
                                </p>
                            </div>
                            <button
                                className="btn btn-icon btn-secondary"
                                onClick={closeModal}
                                style={{ fontSize: '1.2rem' }}
                            >
                                ✕
                            </button>
                        </div>

                        {(selectedCar.images?.length || selectedCar.imageUrls?.length || selectedCar.image) ? (
                            <CarGallery
                                title={selectedCar.title}
                                images={selectedCar.images || selectedCar.imageUrls || [selectedCar.image]}
                                selectedImageIndex={selectedImageIndex}
                                setSelectedImageIndex={setSelectedImageIndex}
                            />
                        ) : null}

                        <div style={{ fontSize: '2rem', fontWeight: 800, marginBottom: '1.5rem' }}>
                            {selectedCar.price || 'Contact for Price'}
                        </div>

                        <div className="detail-recommendation" style={{ marginBottom: '1.5rem' }}>
                            <h4>
                                {selectedCar.recommendation === 'buy' ? '🟢' : '🟡'}
                                {' '}AI Verdict: {selectedCar.recommendation === 'buy' ? 'GREAT DEAL' : 'CONSIDER'}
                            </h4>
                            <p>{selectedCar.aiExplanation}</p>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
                            <ScoreBarInline label="Overall" score={selectedCar.overallScore} variant="purple" />
                            <ScoreBarInline label="Value" score={selectedCar.valueScore} variant="purple" />
                            <ScoreBarInline label="Condition Score" score={selectedCar.conditionScore} variant="orange" />
                            <ScoreBarInline label="Buy Score" score={selectedCar.buyScore} variant="green" />
                            <ScoreBarInline label="Match" score={selectedCar.matchScore} variant="orange" />
                            {selectedCar.reliabilityScore ? (
                                <ScoreBarInline label="Reliability" score={selectedCar.reliabilityScore} variant="green" />
                            ) : null}
                        </div>

                        {selectedCar.scoreBreakdown ? (
                            <div style={{ marginBottom: '1.5rem' }}>
                                <h4 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>Scoring Signals</h4>
                                <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem', lineHeight: 1.6 }}>
                                    Budget fit: <strong>{selectedCar.scoreBreakdown.budgetFit || 'unknown'}</strong> ·
                                    {' '}Market position: <strong>{selectedCar.scoreBreakdown.marketPosition || 'unknown'}</strong> ·
                                    {' '}Title: <strong>{selectedCar.scoreBreakdown.titleStatus || 'unknown'}</strong> ·
                                    {' '}Accident: <strong>{selectedCar.scoreBreakdown.accidentSeverity || 'none'}</strong> ·
                                    {' '}Seller: <strong>{selectedCar.scoreBreakdown.sellerType || 'unknown'}</strong> ·
                                    {' '}Owners: <strong>{selectedCar.scoreBreakdown.ownerCount ?? 'N/A'}</strong> ·
                                    {' '}Service records: <strong>{selectedCar.scoreBreakdown.serviceRecordCount ?? 'N/A'}</strong> ·
                                    {' '}Miles/year: <strong>{selectedCar.scoreBreakdown.mileagePerYear ?? 'N/A'}</strong> ·
                                    {' '}Listing age: <strong>{selectedCar.scoreBreakdown.listingAgeDays ?? 'N/A'} days</strong> ·
                                    {' '}VIN: <strong>{selectedCar.scoreBreakdown.hasVin ? 'yes' : 'no'}</strong> ·
                                    {' '}Photos: <strong>{selectedCar.scoreBreakdown.imageCount ?? '0'}</strong> ·
                                    {' '}Data completeness: <strong>{selectedCar.scoreBreakdown.listingCompleteness ?? 'N/A'}%</strong>
                                    {selectedCar.scoreBreakdown.researchAvailable ? (
                                        <>
                                            {' '}· Reddit research: <strong>{selectedCar.scoreBreakdown.researchScore ?? 'N/A'}/10</strong>
                                            {' '}· Reliability: <strong>{selectedCar.scoreBreakdown.redditReliabilityScore ?? 'N/A'}/10</strong>
                                            {' '}· Reliability rating: <strong>{selectedCar.scoreBreakdown.reliabilityRating || 'unknown'}</strong>
                                        </>
                                    ) : null}
                                </p>
                            </div>
                        ) : null}

                        {selectedCar.research ? (
                            <div style={{ marginBottom: '1.5rem' }}>
                                <h4 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>Reddit Research</h4>
                                <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem', lineHeight: 1.6 }}>
                                    {selectedCar.research.verdict || 'Reddit research was included in the score.'}
                                </p>
                                {selectedCar.research.knownIssues?.length ? (
                                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem', lineHeight: 1.6, marginTop: '0.5rem' }}>
                                        Known issues: <strong>{selectedCar.research.knownIssues.join(', ')}</strong>
                                    </p>
                                ) : null}
                            </div>
                        ) : null}

                        {selectedCar.description ? (
                            <div style={{ marginBottom: '1.5rem' }}>
                                <h4 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>Description</h4>
                                <p style={{
                                    color: 'var(--color-text-secondary)',
                                    fontSize: '0.875rem',
                                    lineHeight: 1.6,
                                    whiteSpace: 'pre-line',
                                }}>
                                    {selectedCar.description.substring(0, 500)}
                                    {selectedCar.description.length > 500 ? '...' : ''}
                                </p>
                            </div>
                        ) : null}

                        <a
                            href={selectedCar.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-primary btn-lg"
                            style={{ width: '100%', textAlign: 'center' }}
                        >
                            View on {selectedCar.source} →
                        </a>
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function CarGallery({ title, images, selectedImageIndex, setSelectedImageIndex }) {
    const galleryImages = (images || []).filter(Boolean);
    if (galleryImages.length === 0) {
        return null;
    }

    return (
        <div style={{ marginBottom: '1.5rem' }}>
            <div
                style={{
                    position: 'relative',
                    borderRadius: '12px',
                    overflow: 'hidden',
                    background: '#111',
                }}
            >
                <img
                    src={galleryImages[selectedImageIndex] || galleryImages[0]}
                    alt={`${title} - Photo ${selectedImageIndex + 1}`}
                    style={{
                        width: '100%',
                        height: '280px',
                        objectFit: 'cover',
                        display: 'block',
                    }}
                />
                {galleryImages.length > 1 ? (
                    <>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setSelectedImageIndex((prev) => (prev - 1 + galleryImages.length) % galleryImages.length);
                            }}
                            style={galleryNavButton('left')}
                        >
                            ‹
                        </button>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setSelectedImageIndex((prev) => (prev + 1) % galleryImages.length);
                            }}
                            style={galleryNavButton('right')}
                        >
                            ›
                        </button>
                        <div style={{
                            position: 'absolute',
                            bottom: '8px',
                            right: '12px',
                            background: 'rgba(0,0,0,0.6)',
                            color: '#fff',
                            padding: '2px 10px',
                            borderRadius: '12px',
                            fontSize: '0.75rem',
                        }}>
                            {selectedImageIndex + 1} / {galleryImages.length}
                        </div>
                    </>
                ) : null}
            </div>
            {galleryImages.length > 1 ? (
                <div style={{
                    display: 'flex',
                    gap: '6px',
                    marginTop: '8px',
                    overflowX: 'auto',
                    paddingBottom: '4px',
                }}>
                    {galleryImages.slice(0, 10).map((url, i) => (
                        <img
                            key={i}
                            src={url}
                            alt={`Thumbnail ${i + 1}`}
                            onClick={(e) => {
                                e.stopPropagation();
                                setSelectedImageIndex(i);
                            }}
                            style={{
                                width: '56px',
                                height: '42px',
                                objectFit: 'cover',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                border: i === selectedImageIndex
                                    ? '2px solid var(--color-accent-secondary, #a78bfa)'
                                    : '2px solid transparent',
                                opacity: i === selectedImageIndex ? 1 : 0.6,
                                transition: 'opacity 0.2s, border-color 0.2s',
                                flexShrink: 0,
                            }}
                        />
                    ))}
                </div>
            ) : null}
        </div>
    );
}

function galleryNavButton(side) {
    return {
        position: 'absolute',
        [side]: '8px',
        top: '50%',
        transform: 'translateY(-50%)',
        background: 'rgba(0,0,0,0.6)',
        color: '#fff',
        border: 'none',
        borderRadius: '50%',
        width: '36px',
        height: '36px',
        cursor: 'pointer',
        fontSize: '1.1rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
    };
}

function ScoreBarInline({ label, score, variant }) {
    const percentage = ((score || 5) / 10) * 100;
    return (
        <div className="score-bar-container">
            <div className="score-bar-label">
                <span>{label}</span>
                <span>{score || 5}/10</span>
            </div>
            <div className="score-bar">
                <div
                    className={`score-bar-fill ${variant}`}
                    style={{ width: `${percentage}%` }}
                />
            </div>
        </div>
    );
}
