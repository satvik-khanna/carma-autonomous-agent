"use client";

export default function RankingBadge({ recommendation }) {
  // We map the old recommendation values to a more generic AI-themed label
  const config = {
    buy: { label: "✨ Top Match" },
    rent: { label: "🔥 Great Value" },
    consider: { label: "⚡ Good Option" },
  };

  const { label } = config[recommendation] || config.consider;

  return <span className="badge">{label}</span>;
}
