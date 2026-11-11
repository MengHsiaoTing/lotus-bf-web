import { useEffect, useState } from 'react'
import { apiFetch } from '../api'
function pubmedLink(row) {
  const pmid = String(row.pmid ?? row.pubmed_id ?? row.study_id ?? '').trim()
  if (/^\d+$/.test(pmid)) return {url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`, direct: true}
  // This Neurosynth backend uses PMID as study_id (verified against its sample and Neurosynth).
  return {url: `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(`"${row.title || ''}"[Title]`)}`, direct: false}
}
export function Studies({query, radius=6}) {
  const [rows, setRows] = useState([]), [loading, setLoading] = useState(true), [error, setError] = useState('')
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1), [sort, setSort] = useState('desc')
  useEffect(() => {
    const ac = new AbortController()
    let cancelled = false
    setLoading(true); setError('')
    apiFetch(`/query/${encodeURIComponent(query)}/studies?r=${radius}&limit=20&offset=${(page - 1) * 20}&sort=${sort}`, {signal: ac.signal}).then(async res => {
      const data = await res.json()
      if (!cancelled) {
        setRows(Array.isArray(data.results) ? data.results : [])
        setTotal(Number(data.total || 0))
      }
    }).catch(e => {if (!cancelled) setError(e.message)}).finally(() => {if (!cancelled) setLoading(false)})
    return () => { cancelled = true; ac.abort() }
  }, [query, radius, page, sort])
  const pages = Math.max(1, Math.ceil(total / 20))
  return <div aria-busy={loading}><div className="section-heading"><h2>Studies</h2><label>Sort <select value={sort} onChange={e => {setSort(e.target.value); setPage(1)}}><option value="desc">Year: newest first</option><option value="asc">Year: oldest first</option></select></label></div>
    {loading ? <p role="status">Searching studies…</p> : error ? <p role="alert" className="error">Search failed: {error}. Check your query and connection, then try again.</p> : <><p className="muted">{total} studies</p>{!rows.length && <p>No matching studies. Try a different query.</p>}
      {rows.map((row,i) => { const link = pubmedLink(row); return <article className="study" key={`${row.study_id || ''}-${i}`}><p className="study-meta">{row.year} · {row.journal || 'Journal unavailable'}</p><h3><a href={link.url} target="_blank" rel="noopener noreferrer">{row.title || 'Untitled study'}</a></h3><p>{Array.isArray(row.authors) ? row.authors.join(', ') : row.authors}</p></article>})}
      {rows.length > 0 && <nav className="pagination" aria-label="Results pages"><button disabled={page === 1} onClick={() => setPage(p => p-1)}>Previous</button><span>{page} / {pages}</span><button disabled={page === pages} onClick={() => setPage(p => p+1)}>Next</button></nav>}
    </>}
  </div>
}
