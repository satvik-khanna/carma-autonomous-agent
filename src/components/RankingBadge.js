'use client';

export default function RankingBadge({ recommendation }) {
    const config = {
        buy: { label: '🟢 Buy', className: 'badge-buy' },
        rent: { label: '🟡 Rent', className: 'badge-rent' },
        consider: { label: '🔵 Consider', className: 'badge-neutral' },
    };

    const { label, className } = config[recommendation] || config.consider;

    return <span className={`badge ${className}`}>{label}</span>;
}
