"use client";

export default function RankingBadge({ recommendation }) {
  return recommendation === "buy"
    ? <span className="tag tag-good">Worth a look</span>
    : <span className="tag tag-maybe">Maybe</span>;
}
