"use client";

export default function ScoreBar({
  label,
  score,
  maxScore = 10,
  variant = "purple",
}) {
  const percentage = (score / maxScore) * 100;

  return (
    <div className="score-bar-container">
      <div className="score-bar-label">
        <span>{label}</span>
        <span>
          {score}/{maxScore}
        </span>
      </div>
      <div className="score-bar">
        <div
          className={`score-bar-fill ${variant}`}
          style={{
            "--target-width": `${percentage}%`,
            animation:
              "fill-bar 1.2s cubic-bezier(0.16, 1, 0.3, 1) forwards, gradient-shift 3s ease infinite",
          }}
        />
      </div>
    </div>
  );
}
