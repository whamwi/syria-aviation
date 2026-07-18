'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function Nav() {
  const path = usePathname()
  const active = (href: string) =>
    path === href || path.startsWith(href + '/')
      ? 'text-[var(--av-gold)] border-b border-[var(--av-gold)]'
      : 'text-[var(--av-ink2)] hover:text-[var(--av-ink)]'

  return (
    <header
      style={{ background: 'var(--av-panel)', borderBottom: '1px solid var(--av-line)' }}
      className="sticky top-0 z-50"
    >
      <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-6">
        {/* Brand */}
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <span className="text-[var(--av-gold)] text-xl">✈</span>
          <span
            className="font-semibold tracking-wide text-[var(--av-ink)]"
            style={{ fontFamily: 'var(--av-font-display)', letterSpacing: '.06em' }}
          >
            SYRIA AVIATION
          </span>
        </Link>

        {/* Nav links */}
        <nav className="flex items-center gap-6 text-sm font-medium tracking-wide">
          <Link href="/" className={`pb-0.5 transition-colors ${active('/')}`}>
            Live Map
          </Link>
          <Link href="/airport/dam" className={`pb-0.5 transition-colors ${active('/airport/dam')}`}>
            Damascus
          </Link>
          <Link href="/airport/alp" className={`pb-0.5 transition-colors ${active('/airport/alp')}`}>
            Aleppo
          </Link>
          <Link href="/airlines" className={`pb-0.5 transition-colors ${active('/airlines')}`}>
            Airlines
          </Link>
        </nav>
      </div>
    </header>
  )
}
