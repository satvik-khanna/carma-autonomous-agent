"use client";

import ScoreBar from "./ScoreBar";
import RankingBadge from "./RankingBadge";

export default function CarCard({ car, rank, onClick }) {
  const placeholderGradient = `linear-gradient(135deg, hsl(${(rank * 40) % 360}, 60%, 25%), hsl(${(rank * 40 + 60) % 360}, 60%, 15%))`;

  return (
    <div
      className="car-card"
      onClick={() => onClick?.(car)}
      role="button"
      tabIndex={0}
    >
      <div className="car-card-image">
        {car.image ? (
          <img src={car.image} alt={car.title} loading="lazy" />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              background: placeholderGradient,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "3rem",
            }}
          >
            🚗
          </div>
        )}

        <div className="car-card-rank">#{rank}</div>

        <div className="car-card-badges">
          {car.recommendation && (
            <RankingBadge recommendation={car.recommendation} />
          )}
        </div>
      </div>

      <div className="car-card-body">
        <h3 className="car-card-title">{car.title}</h3>
        <p className="car-card-subtitle">
          {[
            car.year,
            car.mileage ? `${Number(car.mileage).toLocaleString()} mi` : null,
          ]
            .filter(Boolean)
            .join(" · ") || "Details available on listing"}
        </p>

        <div className="car-card-price">
          {car.price || "Contact for Price"}
          {car.price && <span className="price-label"> asking price</span>}
        </div>

        <div className="car-card-scores">
          <ScoreBar
            label="AI Match Score"
            score={Math.max(
              car.valueScore || 5,
              car.buyScore || 5,
              car.rentScore || 5,
            )}
          />
        </div>

        {car.aiExplanation && (
          <div className="car-card-ai-note">💡 {car.aiExplanation}</div>
        )}

        <div className="car-card-footer">
          <span className="car-card-source">📍 {car.source}</span>
          <a
            href={car.url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
            onClick={(e) => e.stopPropagation()}
            style={{ fontSize: "0.75rem", padding: "4px 12px" }}
          >
            View Listing →
          </a>
        </div>
      </div>
    </div>
  );
}
