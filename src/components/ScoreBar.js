"use client";

export default function ScoreBar({ label, score, maxScore = 10 }) {
  const value = Number.isFinite(Number(score)) ? Number(score) : 0;
  const percentage = Math.max(0, Math.min(100, (value / maxScore) * 100));

  return (
    <div className="bar-row">
      <span>{label}</span>
      <div className="bar-track">
        <div className="bar-fill" style={{ width: `${percentage}%` }} />
      </div>
      <span className="bar-value">{value}</span>
    </div>
  );
}
