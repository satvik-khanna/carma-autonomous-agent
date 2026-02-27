'use client';

export default function ScoreBar({ label, score, maxScore = 10, variant = 'purple' }) {
    const percentage = (score / maxScore) * 100;

    return (
        <div className="score-bar-container">
            <div className="score-bar-label">
                <span>{label}</span>
                <span>{score}/{maxScore}</span>
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
