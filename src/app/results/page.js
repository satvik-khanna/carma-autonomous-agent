"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import CarCard from "@/components/CarCard";
import { sortCarsByScoreDesc } from "@/lib/scoringSort";

export default function ResultsPage() {
  const router = useRouter();
  const [results, setResults] = useState(null);
  const [sortBy, setSortBy] = useState("overallScore");
  const [filterRecommendation, setFilterRecommendation] = useState("all");
  const [selectedCar, setSelectedCar] = useState(null);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);

  useEffect(() => {
    const stored = sessionStorage.getItem("carma-results");
    if (stored) {
      setResults(JSON.parse(stored));
    }
  }, []);

  if (!results) {
    return (
      <div
        className="loading-container"
        style={{ minHeight: "80vh", paddingTop: "8rem" }}
      >
        <div className="loading-spinner" />
        <p className="loading-text">Loading results...</p>
        <button className="btn btn-secondary" onClick={() => router.push("/")}>
          ← Back to Search
        </button>
      </div>
    );
  }

  let cars = [...(results.rankings || [])];

  // Filter
  if (filterRecommendation !== "all") {
    cars = cars.filter((c) => c.recommendation === filterRecommendation);
  }

  // Sort
  if (sortBy === "overallScore") {
    cars = sortCarsByScoreDesc(cars);
  } else {
    cars.sort((a, b) => (b[sortBy] || 0) - (a[sortBy] || 0));
  }

  return (
    <div className="container">
      <div className="results-header">
        <h2>
          Results for &quot;
          <span style={{ color: "var(--color-accent-secondary)" }}>
            {results.query}
          </span>
          &quot;
        </h2>
        <p className="results-meta">
          {cars.length} cars found · Ranked by AI · Searched at{" "}
          {new Date(results.timestamp).toLocaleTimeString()}
        </p>

        {/* Controls */}
        <div
          style={{
            display: "flex",
            gap: "1rem",
            marginTop: "1.5rem",
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <div className="input-group" style={{ minWidth: "180px" }}>
            <label htmlFor="sortBy">Sort By</label>
            <select
              id="sortBy"
              className="input"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
            >
              <option value="overallScore">Overall Score</option>
              <option value="valueScore">Value Score</option>
              <option value="matchScore">Match Score</option>
              <option value="priceNumeric">Price (High to Low)</option>
            </select>
          </div>

          <div className="input-group" style={{ minWidth: "180px" }}>
            <label htmlFor="filter">Filter</label>
            <select
              id="filter"
              className="input"
              value={filterRecommendation}
              onChange={(e) => setFilterRecommendation(e.target.value)}
            >
              <option value="all">All Recommendations</option>
              <option value="buy">✨ Top Match</option>
              <option value="rent">🔥 Great Value</option>
              <option value="consider">⚡ Good Option</option>
            </select>
          </div>

          <div style={{ marginLeft: "auto" }}>
            <button
              className="btn btn-secondary"
              onClick={() => router.push("/")}
            >
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

      {cars.length === 0 && (
        <div
          style={{
            textAlign: "center",
            padding: "4rem 0",
            color: "var(--color-text-secondary)",
          }}
        >
          <p style={{ fontSize: "1.5rem", marginBottom: "1rem" }}>
            No cars match your filter
          </p>
          <button
            className="btn btn-primary"
            onClick={() => setFilterRecommendation("all")}
          >
            Show All Results
          </button>
        </div>
      )}

      {/* Detail Modal */}
      {selectedCar && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 200,
            background: "rgba(0,0,0,0.7)",
            backdropFilter: "blur(8px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "2rem",
          }}
          onClick={() => setSelectedCar(null)}
        >
          <div
            className="card"
            style={{
              maxWidth: "640px",
              width: "100%",
              maxHeight: "80vh",
              overflow: "auto",
              padding: "2rem",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                marginBottom: "1.5rem",
              }}
            >
              <div>
                <h3 style={{ fontSize: "1.5rem", marginBottom: "0.25rem" }}>
                  {selectedCar.title}
                </h3>
                <p
                  style={{
                    color: "var(--color-text-secondary)",
                    fontSize: "0.875rem",
                  }}
                >
                  {selectedCar.source} · {selectedCar.year || "N/A"}
                  {selectedCar.mileage
                    ? ` · ${Number(selectedCar.mileage).toLocaleString()} miles`
                    : ""}
                </p>
              </div>
              <button
                className="btn btn-icon btn-secondary"
                onClick={() => setSelectedCar(null)}
                style={{ fontSize: "1.2rem" }}
              >
                ✕
              </button>
            </div>

            {/* Image Gallery */}
            {selectedCar.imageUrls && selectedCar.imageUrls.length > 0 && (
              <div style={{ marginBottom: "1.5rem" }}>
                <div
                  style={{
                    position: "relative",
                    borderRadius: "12px",
                    overflow: "hidden",
                    background: "#111",
                  }}
                >
                  <img
                    src={
                      selectedCar.imageUrls[selectedImageIndex] ||
                      selectedCar.imageUrls[0]
                    }
                    alt={`${selectedCar.title} - Photo ${selectedImageIndex + 1}`}
                    style={{
                      width: "100%",
                      height: "280px",
                      objectFit: "cover",
                      display: "block",
                    }}
                  />
                  {selectedCar.imageUrls.length > 1 && (
                    <>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedImageIndex(
                            (prev) =>
                              (prev - 1 + selectedCar.imageUrls.length) %
                              selectedCar.imageUrls.length,
                          );
                        }}
                        style={{
                          position: "absolute",
                          left: "8px",
                          top: "50%",
                          transform: "translateY(-50%)",
                          background: "rgba(0,0,0,0.6)",
                          color: "#fff",
                          border: "none",
                          borderRadius: "50%",
                          width: "36px",
                          height: "36px",
                          cursor: "pointer",
                          fontSize: "1.1rem",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        ‹
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedImageIndex(
                            (prev) => (prev + 1) % selectedCar.imageUrls.length,
                          );
                        }}
                        style={{
                          position: "absolute",
                          right: "8px",
                          top: "50%",
                          transform: "translateY(-50%)",
                          background: "rgba(0,0,0,0.6)",
                          color: "#fff",
                          border: "none",
                          borderRadius: "50%",
                          width: "36px",
                          height: "36px",
                          cursor: "pointer",
                          fontSize: "1.1rem",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        ›
                      </button>
                      <div
                        style={{
                          position: "absolute",
                          bottom: "8px",
                          right: "12px",
                          background: "rgba(0,0,0,0.6)",
                          color: "#fff",
                          padding: "2px 10px",
                          borderRadius: "12px",
                          fontSize: "0.75rem",
                        }}
                      >
                        {selectedImageIndex + 1} /{" "}
                        {selectedCar.imageUrls.length}
                      </div>
                    </>
                  )}
                </div>
                {selectedCar.imageUrls.length > 1 && (
                  <div
                    style={{
                      display: "flex",
                      gap: "6px",
                      marginTop: "8px",
                      overflowX: "auto",
                      paddingBottom: "4px",
                    }}
                  >
                    {selectedCar.imageUrls.slice(0, 10).map((url, i) => (
                      <img
                        key={i}
                        src={url}
                        alt={`Thumbnail ${i + 1}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedImageIndex(i);
                        }}
                        style={{
                          width: "56px",
                          height: "42px",
                          objectFit: "cover",
                          borderRadius: "6px",
                          cursor: "pointer",
                          border:
                            i === selectedImageIndex
                              ? "2px solid var(--color-accent-secondary, #a78bfa)"
                              : "2px solid transparent",
                          opacity: i === selectedImageIndex ? 1 : 0.6,
                          transition: "opacity 0.2s, border-color 0.2s",
                          flexShrink: 0,
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            <div
              style={{
                fontSize: "2rem",
                fontWeight: 800,
                marginBottom: "1.5rem",
              }}
            >
              {selectedCar.price || "Contact for Price"}
            </div>

            <div
              className="detail-recommendation"
              style={{ marginBottom: "1.5rem" }}
            >
              <h4>
                {selectedCar.recommendation === "buy" ? "🟢" : "🔵"} AI
                Recommendation:{" "}
                {selectedCar.recommendation?.toUpperCase() === "RENT"
                  ? "CONSIDER"
                  : selectedCar.recommendation?.toUpperCase() || "CONSIDER"}
              </h4>
              <p>{selectedCar.aiExplanation}</p>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.75rem",
                marginBottom: "1.5rem",
              }}
            >
              <ScoreBarInline
                label="Overall"
                score={selectedCar.overallScore}
                variant="purple"
              />
              <ScoreBarInline
                label="Value"
                score={selectedCar.valueScore}
                variant="purple"
              />
              <ScoreBarInline
                label="Buy Score"
                score={selectedCar.buyScore}
                variant="green"
              />
              <ScoreBarInline
                label="Match"
                score={selectedCar.matchScore}
                variant="purple"
              />
            </div>

            {selectedCar.description && (
              <div style={{ marginBottom: "1.5rem" }}>
                <h4 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>
                  Description
                </h4>
                <p
                  style={{
                    color: "var(--color-text-secondary)",
                    fontSize: "0.875rem",
                    lineHeight: 1.6,
                    whiteSpace: "pre-line",
                  }}
                >
                  {selectedCar.description}
                </p>
              </div>
            )}

            <a
              href={selectedCar.url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary btn-lg"
              style={{ width: "100%", textAlign: "center" }}
            >
              View on {selectedCar.source} →
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

/** Small inline score bar for the modal */
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
