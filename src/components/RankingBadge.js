'use client';

export default function RankingBadge({ recommendation }) {
    const config = {
        buy: { label: '🟢 Buy', className: 'badge-buy' },
        consider: { label: '🔵 Consider', className: 'badge-neutral' },
    };

    const { label, className } = config[recommendation] || config.consider;

    return <span className={`badge ${className}`}>{label}</span>;
}
