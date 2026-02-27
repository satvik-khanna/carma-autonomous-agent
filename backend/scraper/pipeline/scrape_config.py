"""
Scraping configuration for Bay Area car listings.
Defines which sites, car models, and search URLs to scrape.
"""

# ── Bay Area Craigslist regions ──
CRAIGSLIST_REGIONS = [
    "sfbay",   # SF Bay Area (main)
]

# ── Car models to scrape ──
CAR_MODELS = [
    {"make": "Toyota",  "model": "Camry",    "query": "toyota+camry"},
    {"make": "Toyota",  "model": "Corolla",  "query": "toyota+corolla"},
    {"make": "Honda",   "model": "Civic",    "query": "honda+civic"},
    {"make": "Honda",   "model": "Accord",   "query": "honda+accord"},
    {"make": "Toyota",  "model": "RAV4",     "query": "toyota+rav4"},
    {"make": "Honda",   "model": "CR-V",     "query": "honda+crv"},
    {"make": "Hyundai", "model": "Elantra",  "query": "hyundai+elantra"},
    {"make": "Nissan",  "model": "Altima",   "query": "nissan+altima"},
    {"make": "Mazda",   "model": "3",        "query": "mazda+3"},
    {"make": "Subaru",  "model": "Outback",  "query": "subaru+outback"},
]

# ── Multi-site search URLs (Tavily will extract these) ──
def get_craigslist_urls(car_query, region="sfbay", sub_area="sby"):
    """Generate Craigslist search URLs for a given car query."""
    base = f"https://{region}.craigslist.org/search/{sub_area}/cta?query={car_query}"
    return [
        f"{base}&sort=date",          # newest first
        f"{base}&sort=dateoldest",    # oldest first
        f"{base}&sort=priceasc",      # cheapest first
    ]


def get_cargurus_urls(make, model):
    """Generate CarGurus search URLs for Bay Area."""
    slug = f"{make}-{model}".lower().replace(" ", "-")
    return [
        f"https://www.cargurus.com/Cars/l-Used-{make}-{model}-Bay-Area-d{slug}",
    ]


def get_cars_com_urls(make, model):
    """Generate Cars.com search URLs for Bay Area."""
    m = make.lower()
    md = model.lower().replace(" ", "_")
    return [
        f"https://www.cars.com/shopping/results/?dealer_id=&keyword=&list_price_max=&list_price_min=&makes[]={m}&maximum_distance=50&models[]={m}-{md}&page_size=20&sort=best_match_desc&stock_type=used&zip=95060",
    ]


def get_autotrader_urls(make, model):
    """Generate AutoTrader search URLs for Bay Area."""
    return [
        f"https://www.autotrader.com/cars-for-sale/used-cars/{make}/{model}/san-jose-ca",
    ]


def get_all_search_configs():
    """
    Return a list of scraping configs — one per car model per site.
    Each config has: make, model, site, urls
    """
    configs = []

    for car in CAR_MODELS:
        make = car["make"]
        model = car["model"]
        query = car["query"]

        # Craigslist (primary — works best with Tavily)
        for region in CRAIGSLIST_REGIONS:
            for sub_area in ["sby", "eby", "pen", "sfc", "scz"]:  # south bay, east bay, peninsula, SF, santa cruz
                configs.append({
                    "make": make,
                    "model": model,
                    "site": "craigslist",
                    "region": f"{region}/{sub_area}",
                    "urls": get_craigslist_urls(query, region, sub_area),
                })

        # CarGurus
        configs.append({
            "make": make,
            "model": model,
            "site": "cargurus",
            "urls": get_cargurus_urls(make, model),
        })

        # Cars.com
        configs.append({
            "make": make,
            "model": model,
            "site": "cars.com",
            "urls": get_cars_com_urls(make, model),
        })

        # AutoTrader
        configs.append({
            "make": make,
            "model": model,
            "site": "autotrader",
            "urls": get_autotrader_urls(make, model),
        })

    return configs


# Quick summary when run directly
if __name__ == "__main__":
    configs = get_all_search_configs()
    print(f"\n📊 Scraping Config Summary")
    print(f"   Car models: {len(CAR_MODELS)}")
    print(f"   Total search configs: {len(configs)}")
    print(f"\n   Models:")
    for car in CAR_MODELS:
        print(f"     - {car['make']} {car['model']}")
    print(f"\n   Sites: Craigslist, CarGurus, Cars.com, AutoTrader")
    print(f"   Region: SF Bay Area (south bay, east bay, peninsula, SF, santa cruz)")
