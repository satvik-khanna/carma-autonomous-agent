'use client';

import ScoreBar from './ScoreBar';
import RankingBadge from './RankingBadge';

export function scoreClass(score) {
    if (score >= 7) return 'score-good';
    if (score >= 5) return 'score-meh';
    return 'score-bad';
}

export default function CarCard({ car, rank, onClick }) {
    const overallScore = car.overallScore || 5;
    const place = car.distanceMiles ? `${car.distanceMiles} mi away` : car.location;
    const meta = [
        car.year,
        car.mileage ? `${Number(car.mileage).toLocaleString()} mi` : 'mileage not listed',
        place,
    ].filter(Boolean).join(' · ');

    const open = () => onClick?.(car);

    return (
        <li
            className="listing"
            onClick={open}
            onKeyDown={(e) => {
                if (e.key === 'Enter') open();
            }}
            role="button"
            tabIndex={0}
        >
            <div className="listing-photo">
                {car.image ? (
                    <img src={car.image} alt={car.title} loading="lazy" />
                ) : (
                    <div className="listing-photo-empty">No photo</div>
                )}
                <span className="listing-rank">{rank}</span>
            </div>

            <div className="listing-body">
                <div className="listing-top">
                    <h3 className="listing-title">{car.title}</h3>
                    <span className="listing-price">{car.price || 'No price'}</span>
                </div>
                <p className="listing-meta">{meta}</p>

                {car.aiExplanation ? <p className="listing-note">{car.aiExplanation}</p> : null}

                <div className="listing-bars">
                    <ScoreBar label="Value" score={car.valueScore || 5} />
                    <ScoreBar label="Condition" score={car.conditionScore || 5} />
                    <ScoreBar label="Buy" score={car.buyScore || 5} />
                    <ScoreBar label="Fit for you" score={car.matchScore || 5} />
                    {car.reliabilityScore ? (
                        <ScoreBar label="Reliability" score={car.reliabilityScore} />
                    ) : null}
                </div>

                <div className="listing-foot">
                    <RankingBadge recommendation={car.recommendation} />
                    {car.estimatedMaintenanceCost ? (
                        <span>~${car.estimatedMaintenanceCost}/yr upkeep</span>
                    ) : null}
                    {car.url ? (
                        <a
                            href={car.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="link-out"
                            onClick={(e) => e.stopPropagation()}
                        >
                            Open on Craigslist ↗
                        </a>
                    ) : null}
                </div>
            </div>

            <div className="listing-score">
                <span className={`score-num ${scoreClass(overallScore)}`}>{overallScore}</span>
                <span className="score-of">/10</span>
            </div>
        </li>
    );
}
