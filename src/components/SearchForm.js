"use client";

import { useState } from "react";

const USE_CASES = [
  { value: "daily commute", label: "Daily Commute", icon: "🏙️" },
  { value: "weekend trips", label: "Weekend Trips", icon: "🛣️" },
  { value: "road trips", label: "Road Trips", icon: "🗺️" },
  { value: "family", label: "Family", icon: "👨‍👩‍👧‍👦" },
  { value: "business", label: "Business", icon: "💼" },
  { value: "fun driving", label: "Performance", icon: "🏎️" },
];

const DURATIONS = [
  { value: "less than 6 months", label: "< 6 mo" },
  { value: "6 months to 1 year", label: "6–12 mo" },
  { value: "1-3 years", label: "1–3 yr" },
  { value: "3+ years", label: "3+ yr" },
];

const BUDGET_MARKS = [200, 400, 600, 800, 1000, 1500, 2000, 3000];

function formatBudget(value) {
  if (value >= 3000) return "$3,000+";
  return `$${value.toLocaleString()}`;
}

export default function SearchForm({ onSearch, loading }) {
  const [formData, setFormData] = useState({
    query: "",
    location: "",
    budget: "800",
    useCase: "daily commute",
    duration: "3+ years",
  });

  const handleChange = (e) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const setField = (name, value) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.query.trim()) return;
    onSearch(formData);
  };

  return (
    <form className="sf" onSubmit={handleSubmit}>
      {/* --- Car Search & Location --- */}
      <div className="sf-section">
        <div className="sf-row">
          <div className="sf-field sf-field-wide">
            <label htmlFor="sf-query" className="sf-label">
              <span className="sf-label-icon">🔍</span>
              What car are you looking for?
            </label>
            <input
              id="sf-query"
              name="query"
              type="text"
              className="sf-input sf-input-hero"
              placeholder="e.g. Toyota Camry, Honda Civic, SUV..."
              value={formData.query}
              onChange={handleChange}
              required
              autoComplete="off"
            />
          </div>
          <div className="sf-field">
            <label htmlFor="sf-location" className="sf-label">
              <span className="sf-label-icon">📍</span>
              Location
            </label>
            <input
              id="sf-location"
              name="location"
              type="text"
              className="sf-input"
              placeholder="City or ZIP"
              value={formData.location}
              onChange={handleChange}
              autoComplete="off"
            />
          </div>
        </div>
      </div>

      {/* --- Budget Slider --- */}
      <div className="sf-section">
        <label className="sf-label">
          <span className="sf-label-icon">💰</span>
          Monthly Budget
          <span className="sf-budget-value">
            {formatBudget(Number(formData.budget))}
          </span>
        </label>
        <div className="sf-slider-wrap">
          <input
            type="range"
            name="budget"
            className="sf-slider"
            min="100"
            max="3000"
            step="50"
            value={formData.budget}
            onChange={handleChange}
            style={{
              "--pct": `${((Number(formData.budget) - 100) / (3000 - 100)) * 100}%`,
            }}
          />
          <div className="sf-slider-marks">
            {BUDGET_MARKS.map((mark) => (
              <span
                key={mark}
                className={`sf-slider-mark ${Number(formData.budget) >= mark ? "active" : ""}`}
              >
                {mark >= 1000 ? `$${mark / 1000}k` : `$${mark}`}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* --- Primary Use --- */}
      <div className="sf-section">
        <label className="sf-label">
          <span className="sf-label-icon">🚗</span>
          Primary Use
        </label>
        <div className="sf-chips">
          {USE_CASES.map((uc) => (
            <button
              key={uc.value}
              type="button"
              className={`sf-chip ${formData.useCase === uc.value ? "sf-chip-active" : ""}`}
              onClick={() => setField("useCase", uc.value)}
            >
              <span className="sf-chip-icon">{uc.icon}</span>
              {uc.label}
            </button>
          ))}
        </div>
      </div>

      {/* --- Duration --- */}
      <div className="sf-section">
        <label className="sf-label">
          <span className="sf-label-icon">⏱️</span>
          How Long?
        </label>
        <div className="sf-segment">
          {DURATIONS.map((d) => (
            <button
              key={d.value}
              type="button"
              className={`sf-segment-btn ${formData.duration === d.value ? "sf-segment-active" : ""}`}
              onClick={() => setField("duration", d.value)}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      {/* --- Submit --- */}
      <div className="sf-actions">
        <button
          type="submit"
          className="sf-submit"
          disabled={loading || !formData.query.trim()}
        >
          {loading ? (
            <>
              <span
                className="loading-spinner"
                style={{ width: 20, height: 20, borderWidth: 2 }}
              />
              Searching across listings...
            </>
          ) : (
            <>
              <span style={{ fontSize: "1.25rem" }}>🚀</span>
              Find My Perfect Car
            </>
          )}
        </button>
      </div>
    </form>
  );
}
