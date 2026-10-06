"use client";

import { useState } from "react";

const USE_CASES = [
  { value: "daily commute", label: "Commuting" },
  { value: "weekend trips", label: "Weekends" },
  { value: "road trips", label: "Road trips" },
  { value: "family", label: "Family" },
  { value: "business", label: "Work" },
  { value: "fun driving", label: "Fun" },
];

const DURATIONS = [
  { value: "less than 6 months", label: "Under 6 mo" },
  { value: "6 months to 1 year", label: "6–12 mo" },
  { value: "1-3 years", label: "1–3 yr" },
  { value: "3+ years", label: "3+ yr" },
];

function formatBudget(value) {
  return value >= 3000 ? "$3,000+/mo" : `$${value.toLocaleString()}/mo`;
}

function formatMileage(value) {
  return value >= 150000 ? "150k+ mi" : `${Math.round(value / 1000)}k mi`;
}

export default function SearchForm({ onSearch, loading, loadingMsg }) {
  const [formData, setFormData] = useState({
    query: "",
    location: "",
    budget: "800",
    maxMileage: "100000",
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
      <div className="sf-grid">
        <div className="field">
          <label htmlFor="sf-query" className="field-label">Car</label>
          <input
            id="sf-query"
            name="query"
            type="text"
            className="input input-lg"
            placeholder="Honda Civic, Toyota Supra, Acura MDX…"
            value={formData.query}
            onChange={handleChange}
            required
            autoComplete="off"
          />
        </div>
        <div className="field">
          <label htmlFor="sf-location" className="field-label">Near</label>
          <input
            id="sf-location"
            name="location"
            type="text"
            className="input input-lg"
            placeholder="San Jose"
            value={formData.location}
            onChange={handleChange}
            autoComplete="off"
          />
        </div>
      </div>

      <div className="sf-grid">
        <div className="field">
          <label htmlFor="sf-budget" className="field-label">
            Monthly budget
            <span className="field-value">{formatBudget(Number(formData.budget))}</span>
          </label>
          <input
            id="sf-budget"
            type="range"
            name="budget"
            className="range"
            min="100"
            max="3000"
            step="50"
            value={formData.budget}
            onChange={handleChange}
          />
          <div className="range-scale">
            <span>$100</span>
            <span>$1,500</span>
            <span>$3,000</span>
          </div>
        </div>
        <div className="field">
          <label htmlFor="sf-mileage" className="field-label">
            Max mileage
            <span className="field-value">{formatMileage(Number(formData.maxMileage))}</span>
          </label>
          <input
            id="sf-mileage"
            type="range"
            name="maxMileage"
            className="range"
            min="10000"
            max="150000"
            step="5000"
            value={formData.maxMileage}
            onChange={handleChange}
          />
          <div className="range-scale">
            <span>10k</span>
            <span>80k</span>
            <span>150k</span>
          </div>
        </div>
      </div>

      <div className="sf-grid">
        <div className="field">
          <span className="field-label">Mostly for</span>
          <div className="seg">
            {USE_CASES.map((uc) => (
              <button
                key={uc.value}
                type="button"
                className={`seg-btn ${formData.useCase === uc.value ? "is-active" : ""}`}
                onClick={() => setField("useCase", uc.value)}
              >
                {uc.label}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="field-label">Keeping it for</span>
          <div className="seg">
            {DURATIONS.map((d) => (
              <button
                key={d.value}
                type="button"
                className={`seg-btn ${formData.duration === d.value ? "is-active" : ""}`}
                onClick={() => setField("duration", d.value)}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="sf-footer">
        <div className="sf-status">
          {loading ? (
            <>
              <strong>{loadingMsg || "Searching…"}</strong>
              <div className="progress" />
            </>
          ) : (
            "Searches Craigslist live. Takes about a minute, longer for popular cars."
          )}
        </div>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={loading || !formData.query.trim()}
        >
          {loading ? "Searching…" : "Search listings"}
        </button>
      </div>
    </form>
  );
}
