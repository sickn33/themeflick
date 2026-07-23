import { Link } from 'react-router-dom'

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <p>© {new Date().getFullYear()} Themeflick</p>
      <nav aria-label="Legal and support">
        <Link to="/about">About</Link>
        <Link to="/privacy">Privacy</Link>
        <Link to="/terms">Terms</Link>
        <Link to="/support">Support</Link>
      </nav>
      <p className="tmdb-notice">This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
    </footer>
  )
}
