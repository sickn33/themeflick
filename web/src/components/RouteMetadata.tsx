import { useEffect } from 'react'

const metadata: Record<string, { title: string; description: string }> = {
  '/': { title: 'Themeflick — Taste-led movie discovery', description: 'Find thoughtful movie recommendations from one title you already love.' },
  '/favorites': { title: 'Favorites — Themeflick', description: 'Review your saved Themeflick movie shortlist.' },
  '/account': { title: 'Account — Themeflick', description: 'Manage favorite sync, export, and deletion.' },
  '/about': { title: 'About — Themeflick', description: 'How Themeflick creates movie recommendations.' },
  '/privacy': { title: 'Privacy — Themeflick', description: 'How Themeflick handles account and favorite data.' },
  '/terms': { title: 'Terms — Themeflick', description: 'Terms for using Themeflick.' },
  '/support': { title: 'Support — Themeflick', description: 'Get help with Themeflick.' },
}

export function RouteMetadata({ pathname }: { pathname: string }) {
  useEffect(() => {
    const entry = pathname.startsWith('/movies/') ? { title: 'Movie — Themeflick', description: 'Movie details and recommendations on Themeflick.' } : metadata[pathname] ?? metadata['/']
    document.title = entry.title
    document.querySelector('meta[name="description"]')?.setAttribute('content', entry.description)
    let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')
    if (!canonical) { canonical = document.createElement('link'); canonical.rel = 'canonical'; document.head.append(canonical) }
    canonical.href = `${window.location.origin}${pathname}`
    document.getElementById('main-content')?.focus({ preventScroll: true })
  }, [pathname])
  return null
}
