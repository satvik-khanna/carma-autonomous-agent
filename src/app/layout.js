import '@/styles/globals.css';

export const metadata = {
    title: 'Carma — Smart Car Buying Recommendations',
    description: 'Find your perfect car purchase. Carma aggregates listings from top car sites and scores each listing from scraped attributes.',
    keywords: ['cars', 'buy car', 'used car', 'car comparison', 'car recommendation'],
};

export default function RootLayout({ children }) {
    return (
        <html lang="en">
            <head>
                <link rel="preconnect" href="https://fonts.googleapis.com" />
                <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
                <link
                    href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap"
                    rel="stylesheet"
                />
            </head>
            <body>
                <div className="page-wrapper">
                    <nav className="navbar">
                        <div className="container navbar-inner">
                            <a href="/" className="navbar-brand">
                                <span className="brand-icon">🚗</span>
                                <span className="brand-gradient">Carma</span>
                            </a>
                            <ul className="navbar-links">
                                <li><a href="/">Search</a></li>
                                <li><a href="#how-it-works">How It Works</a></li>
                            </ul>
                        </div>
                    </nav>

                    <main>{children}</main>

                    <footer className="footer">
                        <div className="container">
                            <p>© 2026 Carma — Built with Tavily, OpenAI & AWS</p>
                        </div>
                    </footer>
                </div>
            </body>
        </html>
    );
}
