"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import SearchForm from "@/components/SearchForm";

export default function HomePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleSearch = async (formData) => {
    setLoading(true);

    try {
      // Step 1: Search for cars via Tavily
      const searchRes = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: formData.query,
          location: formData.location,
          maxResults: 10,
          includeRentals: formData.preference !== "prefer buying",
        }),
      });

      const searchData = await searchRes.json();

      // Step 2: Enrich with Craigslist images from local data
      let enrichedListings = searchData.success ? searchData.listings : [];

      try {
        const clRes = await fetch(
          `/api/craigslist?q=${encodeURIComponent(formData.query)}`,
        );
        const clData = await clRes.json();

        if (clData.success && clData.listings.length > 0) {
          const clListings = clData.listings;

          // Enrich existing Tavily results with Craigslist images (by URL match)
          enrichedListings = enrichedListings.map((listing) => {
            const clMatch = clListings.find((cl) => cl.url === listing.url);
            if (clMatch && clMatch.image_urls.length > 0) {
              return {
                ...listing,
                image: clMatch.image_urls[0],
                imageUrls: clMatch.image_urls,
              };
            }
            return listing;
          });

          // Add Craigslist listings that Tavily didn't find
          const existingUrls = new Set(enrichedListings.map((l) => l.url));
          const newCl = clListings
            .filter(
              (cl) => !existingUrls.has(cl.url) && cl.image_urls.length > 0,
            )
            .map((cl) => ({
              id: cl.id,
              title: cl.title,
              price: cl.price_usd ? `$${cl.price_usd.toLocaleString()}` : null,
              priceNumeric: cl.price_usd,
              year: cl.year,
              mileage: cl.mileage,
              description: "",
              url: cl.url,
              source: "Craigslist",
              image: cl.image_urls[0],
              imageUrls: cl.image_urls,
              listingType: "buy",
              fetchedAt: new Date().toISOString(),
            }));

          enrichedListings = [...enrichedListings, ...newCl];
        }
      } catch (clError) {
        console.warn("Craigslist enrichment failed (non-fatal):", clError);
      }

      if (enrichedListings.length === 0) {
        setLoading(false);
        alert("No car listings found. Try a different search.");
        return;
      }

      // Step 3: Rank the cars via OpenAI
      const rankRes = await fetch("/api/rank", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cars: enrichedListings,
          preferences: {
            budget: formData.budget,
            useCase: formData.useCase,
            duration: formData.duration,
            location: formData.location,
            preference: formData.preference,
          },
        }),
      });

      const rankData = await rankRes.json();

      // Store results in sessionStorage for the results page
      sessionStorage.setItem(
        "carma-results",
        JSON.stringify({
          rankings: rankData.rankings || searchData.listings,
          query: formData.query,
          preferences: formData,
          timestamp: new Date().toISOString(),
        }),
      );

      router.push("/results");
    } catch (error) {
      console.error("Search failed:", error);
      alert("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <section className="hero">
        <div className="container">
          <h1 className="hero-title animate-fade-in-up">
            Find Your Perfect Car,{" "}
            <span className="gradient-text">Smarter</span>
          </h1>
          <p className="hero-subtitle animate-fade-in-up animate-delay-1">
            Carma searches top car sites, ranks every listing with AI, and tells
            you whether to <strong>buy or rent</strong> — personalized to your
            budget and lifestyle.
          </p>

          <div className="animate-fade-in-up animate-delay-2">
            <SearchForm onSearch={handleSearch} loading={loading} />
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" style={{ padding: "5rem 0" }}>
        <div className="container">
          <h2
            style={{
              textAlign: "center",
              marginBottom: "3rem",
              fontSize: "2rem",
            }}
          >
            How It Works
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
              gap: "2rem",
            }}
          >
            {[
              {
                icon: "🔍",
                title: "Search",
                desc: "Tell us what car you're looking for, your budget, and how you'll use it.",
              },
              {
                icon: "🌐",
                title: "Aggregate",
                desc: "We search Cars.com, CarGurus, AutoTrader and more to find every listing.",
              },
              {
                icon: "🤖",
                title: "AI Ranking",
                desc: "OpenAI analyzes each car and scores it on value, buy potential, and rent suitability.",
              },
              {
                icon: "✅",
                title: "Decide",
                desc: "See ranked results with buy vs rent recommendations tailored to you.",
              },
            ].map((step, i) => (
              <div
                key={i}
                className="card animate-fade-in-up"
                style={{
                  padding: "2rem",
                  textAlign: "center",
                  animationDelay: `${i * 0.15}s`,
                  opacity: 0,
                }}
              >
                <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>
                  {step.icon}
                </div>
                <h3 style={{ fontSize: "1.25rem", marginBottom: "0.75rem" }}>
                  {step.title}
                </h3>
                <p
                  style={{
                    color: "var(--color-text-secondary)",
                    fontSize: "0.9rem",
                  }}
                >
                  {step.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
