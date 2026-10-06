import '@/styles/globals.css';

export const metadata = {
    title: 'Carma — used cars from Craigslist, ranked',
    description: 'Carma searches Craigslist for the car you want, drops the sketchy listings, and ranks the rest against your budget.',
};

export default function RootLayout({ children }) {
    return (
        <html lang="en">
            <head>
                <link rel="preconnect" href="https://fonts.googleapis.com" />
                <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
                <link
                    href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&family=Instrument+Serif:ital@0;1&display=swap"
                    rel="stylesheet"
                />
            </head>
            <body>
                <div className="page-wrapper">
                    <nav className="nav">
                        <div className="container nav-inner">
                            <a href="/" className="brand">
                                carma<span className="brand-dot">.</span>
                            </a>
                            <ul className="nav-links">
                                <li><a href="/">New search</a></li>
                                <li><a href="/#how">How ranking works</a></li>
                            </ul>
                        </div>
                    </nav>

                    <main>{children}</main>

                    <footer className="footer">
                        <div className="container">
                            <span>Carma · listings come straight from Craigslist</span>
                            <span>Not affiliated with Craigslist. Always see the car in person.</span>
                        </div>
                    </footer>
                </div>
            </body>
        </html>
    );
}
