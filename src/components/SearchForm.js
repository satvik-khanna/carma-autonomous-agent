'use client';

import { useState } from 'react';

export default function SearchForm({ onSearch, loading, loadingMsg }) {
    const [formData, setFormData] = useState({
        query: '',
        location: '',
        budget: '',
        useCase: 'daily commute',
        duration: '3+ years',
    });

    const handleChange = (e) => {
        setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!formData.query.trim()) return;
        onSearch(formData);
    };

    return (
        <form className="search-form" onSubmit={handleSubmit}>
            <div className="search-form-row">
                <div className="input-group">
                    <label htmlFor="query">What car are you looking for?</label>
                    <input
                        id="query"
                        name="query"
                        type="text"
                        className="input"
                        placeholder="e.g. Toyota Camry, Honda Civic, SUV..."
                        value={formData.query}
                        onChange={handleChange}
                        required
                    />
                </div>

                <div className="input-group">
                    <label htmlFor="location">Your Location</label>
                    <input
                        id="location"
                        name="location"
                        type="text"
                        className="input"
                        placeholder="e.g. San Jose, 94043..."
                        value={formData.location}
                        onChange={handleChange}
                    />
                </div>

                <div className="input-group">
                    <label htmlFor="budget">Max Budget ($)</label>
                    <input
                        id="budget"
                        name="budget"
                        type="number"
                        className="input"
                        placeholder="e.g. 25000"
                        value={formData.budget}
                        onChange={handleChange}
                    />
                </div>
            </div>

            <div className="search-form-row">
                <div className="input-group">
                    <label htmlFor="useCase">Primary Use</label>
                    <select
                        id="useCase"
                        name="useCase"
                        className="input"
                        value={formData.useCase}
                        onChange={handleChange}
                    >
                        <option value="daily commute">Daily Commute</option>
                        <option value="weekend trips">Weekend Trips</option>
                        <option value="road trips">Road Trips</option>
                        <option value="family">Family Use</option>
                        <option value="business">Business</option>
                        <option value="fun driving">Fun / Performance</option>
                    </select>
                </div>

                <div className="input-group">
                    <label htmlFor="duration">How Long Do You Plan to Keep It?</label>
                    <select
                        id="duration"
                        name="duration"
                        className="input"
                        value={formData.duration}
                        onChange={handleChange}
                    >
                        <option value="less than 1 year">Less than 1 year</option>
                        <option value="1-3 years">1–3 years</option>
                        <option value="3+ years">3+ years (long term)</option>
                    </select>
                </div>
            </div>

            <div className="search-form-actions">
                <button
                    type="submit"
                    className="btn btn-primary btn-lg"
                    disabled={loading || !formData.query.trim()}
                    style={{ minWidth: '200px' }}
                >
                    {loading ? (
                        <>
                            <span className="loading-spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
                            Searching...
                        </>
                    ) : (
                        <>🔍 Find My Car</>
                    )}
                </button>
                {loadingMsg && (
                    <p style={{
                        marginTop: '1rem',
                        color: 'var(--color-primary)',
                        fontSize: '0.9rem',
                        textAlign: 'center',
                        animation: 'pulse 1.5s ease-in-out infinite',
                    }}>
                        {loadingMsg}
                    </p>
                )}
            </div>
        </form>
    );
}
