import { useEffect, useMemo, useState } from 'react'

export function Terms ({ onPickTerm }) {
  const [terms, setTerms] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    const ac = new AbortController()
    const load = async () => {
      setLoading(true)
      setErr('')
      try {
        const res = await fetch('/terms', { signal: ac.signal })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (!alive) return
        setTerms(Array.isArray(data?.terms) ? data.terms : [])
      } catch (e) {
        if (!alive) return
        setErr(`Failed to fetch terms: ${e?.message || e}`)
      } finally {
        if (alive) setLoading(false)
      }
    }
    load()
    return () => { alive = false; ac.abort() }
  }, [])

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return terms
    return terms.filter(t => t.toLowerCase().includes(s))
  }, [terms, search])

  return (
    <div className='terms'>
      {/* Removed internal <h2> to avoid double "Terms" header. The bold title now comes from App.jsx card__title. */}

      <div className='terms__controls'>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder='Search terms…'
          className='input'
        />
        <button
          onClick={() => setSearch('')}
          className='btn btn--primary'
        >
          Clear
        </button>
      </div>

      {loading && (
        <div className='terms__skeleton'>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className='terms__skeleton-row' />
          ))}
        </div>
      )}

      {err && (
        <div className='alert alert--error'>
          {err}
        </div>
      )}

      {!loading && !err && (
        <div className='terms__list'>
          {filtered.length === 0 ? (
            <div className='terms__empty'>No terms found</div>
          ) : (
            <ul className='terms__ul'>
              {filtered.slice(0, 500).map((t, idx) => (
                <li key={`${t}-${idx}`} className='terms__li'>
                  <a
  href="#"
  className='terms__name'
  title={t}
  aria-label={`Add term ${t}`}
  onClick={(e) => { e.preventDefault(); onPickTerm?.(t); }}
>
  {t}
</a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

