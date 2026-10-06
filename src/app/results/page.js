'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import CarCard, { scoreClass } from '@/components/CarCard';
import ScoreBar from '@/components/ScoreBar';
import RankingBadge from '@/components/RankingBadge';
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

    useEffect(() => {
        if (!selectedCar) return undefined;
        const onKey = (e) => {
            if (e.key === 'Escape') closeModal();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [selectedCar]);

    if (!results) {
        return (
            <div className="container empty">
                <p>No search results yet.</p>
                <button className="btn" onClick={() => router.push('/')}>
                    Start a search
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
    } else if (sortBy === 'priceAsc') {
        cars = [...cars].sort((a, b) => (Number(a.priceNumeric) || Infinity) - (Number(b.priceNumeric) || Infinity));
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

    function closeModal() {
        setSelectedCar(null);
        setSelectedImageIndex(0);
    }

    const total = results.rankings?.length || 0;
    const searchedAt = new Date(results.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

    return (
        <div className="container">
            <header className="results-head">
                <h1 className="results-title">{results.query}</h1>
                <p className="results-meta">
                    {total} {total === 1 ? 'listing' : 'listings'} on Craigslist right now · searched at {searchedAt}
                </p>
                {results.searchContext?.reliabilityIntent ? (
                    <p className="results-meta">
                        {results.searchContext.researchApplied
                            ? 'You asked about reliability, so Reddit owner reports were factored into the scores.'
                            : 'You asked about reliability, but no Reddit owner reports came back, so scores use the listings alone.'}
                    </p>
                ) : null}
            </header>

            <div className="toolbar">
                <label>
                    Sort
                    <select className="select" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                        <option value="overallScore">Best score</option>
                        <option value="priceAsc">Lowest price</option>
                        <option value="valueScore">Best value</option>
                        <option value="matchScore">Best fit for you</option>
                        <option value="reliabilityScore">Most reliable</option>
                    </select>
                </label>
                <label>
                    Show
                    <select className="select" value={filterRecommendation} onChange={(e) => setFilterRecommendation(e.target.value)}>
                        <option value="all">Everything</option>
                        <option value="buy">Worth a look</option>
                        <option value="consider">Maybe</option>
                    </select>
                </label>
                <span className="toolbar-spacer" />
                <button className="btn btn-sm" onClick={() => router.push('/')}>
                    New search
                </button>
            </div>

            {cars.length === 0 ? (
                <div className="empty">
                    <p>Nothing matches that filter.</p>
                    <button className="btn" onClick={() => setFilterRecommendation('all')}>
                        Show everything
                    </button>
                </div>
            ) : (
                <ol className="listing-list">
                    {cars.map((car, index) => (
                        <CarCard
                            key={car.id || index}
                            car={car}
                            rank={index + 1}
                            onClick={(c) => {
                                setSelectedCar(c);
                                setSelectedImageIndex(0);
                            }}
                        />
                    ))}
                </ol>
            )}

            {selectedCar ? (
                <div className="modal-backdrop" onClick={closeModal}>
                    <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-head">
                            <div>
                                <h2 className="modal-title">{selectedCar.title}</h2>
                                <p className="results-meta">
                                    {[
                                        selectedCar.year,
                                        selectedCar.mileage ? `${Number(selectedCar.mileage).toLocaleString()} mi` : null,
                                        selectedCar.location,
                                    ].filter(Boolean).join(' · ')}
                                </p>
                            </div>
                            <button className="modal-close" onClick={closeModal} aria-label="Close">
                                ×
                            </button>
                        </div>

                        <CarGallery
                            title={selectedCar.title}
                            images={selectedCar.images || selectedCar.imageUrls || [selectedCar.image]}
                            selectedImageIndex={selectedImageIndex}
                            setSelectedImageIndex={setSelectedImageIndex}
                        />

                        <div className="modal-price-row">
                            <span className="modal-price">{selectedCar.price || 'No price listed'}</span>
                            <span>
                                <span className={`score-num ${scoreClass(selectedCar.overallScore || 5)}`}>
                                    {selectedCar.overallScore || 5}
                                </span>
                                <span className="score-of">/10</span>
                            </span>
                        </div>

                        <div className="modal-section">
                            <h4>Our take <RankingBadge recommendation={selectedCar.recommendation} /></h4>
                            <p>{selectedCar.aiExplanation}</p>
                        </div>

                        <div className="modal-section modal-bars">
                            <ScoreBar label="Value" score={selectedCar.valueScore || 5} />
                            <ScoreBar label="Condition" score={selectedCar.conditionScore || 5} />
                            <ScoreBar label="Buy" score={selectedCar.buyScore || 5} />
                            <ScoreBar label="Fit for you" score={selectedCar.matchScore || 5} />
                            {selectedCar.reliabilityScore ? (
                                <ScoreBar label="Reliability" score={selectedCar.reliabilityScore} />
                            ) : null}
                        </div>

                        {selectedCar.scoreBreakdown ? (
                            <div className="modal-section">
                                <h4>What went into the score</h4>
                                <Signals breakdown={selectedCar.scoreBreakdown} />
                            </div>
                        ) : null}

                        {selectedCar.research?.verdict ? (
                            <div className="modal-section">
                                <h4>What owners on Reddit say</h4>
                                <p>{selectedCar.research.verdict}</p>
                                {selectedCar.research.knownIssues?.length ? (
                                    <p>Known issues: {selectedCar.research.knownIssues.join(', ')}</p>
                                ) : null}
                            </div>
                        ) : null}

                        {selectedCar.description ? (
                            <div className="modal-section">
                                <h4>From the ad</h4>
                                <p style={{ whiteSpace: 'pre-line' }}>
                                    {selectedCar.description.substring(0, 500)}
                                    {selectedCar.description.length > 500 ? '…' : ''}
                                </p>
                            </div>
                        ) : null}

                        {selectedCar.url ? (
                            <a
                                href={selectedCar.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn btn-primary btn-block"
                            >
                                Open the ad on Craigslist ↗
                            </a>
                        ) : null}
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function Signals({ breakdown: b }) {
    const rows = [
        ['Budget fit', b.budgetFit || 'unknown'],
        ['Price vs. similar cars', b.marketPosition || 'unknown'],
        ['Title', b.titleStatus || 'unknown'],
        ['Accident history', b.accidentSeverity || 'none mentioned'],
        ['Seller', b.sellerType || 'unknown'],
        ['Owners', b.ownerCount ?? '—'],
        ['Service records', b.serviceRecordCount ?? '—'],
        ['Miles per year', b.mileagePerYear != null ? Number(b.mileagePerYear).toLocaleString() : '—'],
        ['Listed', b.listingAgeDays != null ? `${b.listingAgeDays} days ago` : '—'],
        ['VIN in ad', b.hasVin ? 'yes' : 'no'],
        ['Photos', b.imageCount ?? 0],
        ['Ad completeness', b.listingCompleteness != null ? `${b.listingCompleteness}%` : '—'],
    ];

    if (b.researchAvailable) {
        rows.push(
            ['Reddit score', b.researchScore != null ? `${b.researchScore}/10` : '—'],
            ['Reddit reliability', b.redditReliabilityScore != null ? `${b.redditReliabilityScore}/10` : '—'],
        );
    }

    return (
        <dl className="signals">
            {rows.map(([label, value]) => (
                <div key={label}>
                    <dt>{label}</dt>
                    <dd>{typeof value === 'string' ? value.replace(/_/g, ' ') : value}</dd>
                </div>
            ))}
        </dl>
    );
}

function CarGallery({ title, images, selectedImageIndex, setSelectedImageIndex }) {
    const galleryImages = (images || []).filter(Boolean);
    if (galleryImages.length === 0) return null;

    const step = (delta) => (e) => {
        e.stopPropagation();
        setSelectedImageIndex((prev) => (prev + delta + galleryImages.length) % galleryImages.length);
    };

    return (
        <div className="gallery">
            <div className="gallery-main">
                <img
                    src={galleryImages[selectedImageIndex] || galleryImages[0]}
                    alt={`${title}, photo ${selectedImageIndex + 1}`}
                />
                {galleryImages.length > 1 ? (
                    <>
                        <button className="gallery-nav prev" onClick={step(-1)} aria-label="Previous photo">‹</button>
                        <button className="gallery-nav next" onClick={step(1)} aria-label="Next photo">›</button>
                        <span className="gallery-count">
                            {selectedImageIndex + 1} / {galleryImages.length}
                        </span>
                    </>
                ) : null}
            </div>
            {galleryImages.length > 1 ? (
                <div className="thumbs">
                    {galleryImages.slice(0, 10).map((url, i) => (
                        <img
                            key={i}
                            src={url}
                            alt=""
                            className={`thumb ${i === selectedImageIndex ? 'is-active' : ''}`}
                            onClick={(e) => {
                                e.stopPropagation();
                                setSelectedImageIndex(i);
                            }}
                        />
                    ))}
                </div>
            ) : null}
        </div>
    );
}
