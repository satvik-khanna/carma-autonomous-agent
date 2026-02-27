'use client';

import ScoreBar from './ScoreBar';
import RankingBadge from './RankingBadge';

export default function CarCard({ car, rank, onClick }) {
    const placeholderGradient = `linear-gradient(135deg, hsl(${(rank * 40) % 360}, 60%, 25%), hsl(${(rank * 40 + 60) % 360}, 60%, 15%))`;
    const overallScore = car.overallScore || 5;
    const scoreColor = overallScore >= 7 ? '#22c55e' : overallScore >= 5 ? '#eab308' : '#ef4444';
    const subtitleLocation = car.distanceMiles ? `${car.distanceMiles} mi away` : car.location;

    return (
        <div className="car-card" onClick={() => onClick?.(car)} role="button" tabIndex={0}>
            <div className="car-card-image">
                {car.image ? (
                    <img src={car.image} alt={car.title} loading="lazy" />
                ) : (
                    <div
                        style={{
                            width: '100%',
                            height: '100%',
                            background: placeholderGradient,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '3rem',
                        }}
                    >
                        🚗
                    </div>
                )}

                <div className="car-card-rank">#{rank}</div>

                <div style={{
                    position: 'absolute',
                    top: '0.5rem',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    background: scoreColor,
                    color: '#000',
                    fontWeight: 800,
                    fontSize: '0.85rem',
                    padding: '4px 12px',
                    borderRadius: '20px',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                }}>
                    {overallScore}/10
                </div>

                <div className="car-card-badges">
                    {car.recommendation && <RankingBadge recommendation={car.recommendation} />}
                </div>
            </div>

            <div className="car-card-body">
                <h3 className="car-card-title">{car.title}</h3>
                <p className="car-card-subtitle">
                    {[
                        car.year,
                        car.mileage ? `${Number(car.mileage).toLocaleString()} mi` : null,
                        subtitleLocation,
                    ].filter(Boolean).join(' · ') || 'Details available on listing'}
                </p>

                <div className="car-card-price">
                    {car.price || 'Contact for Price'}
                    {car.price && <span className="price-label"> asking price</span>}
                </div>

                {car.estimatedMaintenanceCost ? (
                    <div style={{
                        fontSize: '0.75rem',
                        color: car.estimatedMaintenanceCost <= 500 ? '#22c55e' : car.estimatedMaintenanceCost >= 1200 ? '#ef4444' : 'var(--color-text-secondary)',
                        marginBottom: '0.75rem',
                    }}>
                        🔧 ~${car.estimatedMaintenanceCost}/yr maintenance
                    </div>
                ) : null}

                <div className="car-card-scores">
                    <ScoreBar label="Value" score={car.valueScore || 5} variant="purple" />
                    <ScoreBar label="Condition" score={car.conditionScore || 5} variant="orange" />
                    <ScoreBar label="Buy Score" score={car.buyScore || 5} variant="green" />
                    <ScoreBar label="Match" score={car.matchScore || 5} variant="orange" />
                    {car.reliabilityScore ? (
                        <ScoreBar label="Reliability" score={car.reliabilityScore} variant="green" />
                    ) : null}
                </div>

                {car.aiExplanation ? (
                    <div className="car-card-ai-note">
                        💡 {car.aiExplanation}
                    </div>
                ) : null}

                {car.research?.verdict ? (
                    <div style={{
                        fontSize: '0.78rem',
                        color: 'var(--color-text-secondary)',
                        marginTop: '-0.25rem',
                        marginBottom: '0.75rem',
                    }}>
                        Reddit: {car.research.verdict}
                    </div>
                ) : null}

                {car.research?.verdict && (
                    <div style={{
                        fontSize: '0.78rem',
                        color: 'var(--color-text-secondary)',
                        marginTop: '-0.25rem',
                        marginBottom: '0.75rem',
                    }}>
                        Reddit: {car.research.verdict}
                    </div>
                )}

                <div className="car-card-footer">
                    <span className="car-card-source">
                        📍 {car.source}
                        {car.location ? ` · ${car.location}` : ''}
                    </span>
                    <a
                        href={car.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-secondary"
                        onClick={(e) => e.stopPropagation()}
                        style={{ fontSize: '0.75rem', padding: '4px 12px' }}
                    >
                        View Listing →
                    </a>
                </div>
            </div>
        </div>
    );
}
