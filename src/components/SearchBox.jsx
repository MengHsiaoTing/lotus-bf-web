import { useEffect, useRef, useState } from 'react'
import './SearchBox.css'

function TermMarquee({terms, onChoose}) {
  if (!terms.length) return null
  return <div className="term-marquee" role="region" aria-label="Scrollable search terms" tabIndex={0}>
    <div className="term-marquee-track"><div className="term-marquee-group">
      {terms.map(term => <button type="button" className="term-marquee-word" key={term}
        onClick={() => onChoose(term)}>{term}</button>)}
    </div></div>
  </div>
}

export function SearchBox({value, onChange, onSearch, showMarquee = false}) {
  const input = useRef(null)
  const [terms, setTerms] = useState([
    'memory', 'attention', 'emotion', 'language',
    'learning', 'vision', 'motor', 'cognition'
  ])
  const [status, setStatus] = useState('Loading terms…')
  const [cursor, setCursor] = useState(value.length)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  useEffect(() => {
    const ac = new AbortController()
    fetch(`${import.meta.env.BASE_URL}terms.json`, {signal: ac.signal}).then(async res => {
      if (!res.ok) throw new Error()
      const data = await res.json()
      const list = [...new Set((data.terms || []).filter(t => typeof t === 'string' && t.trim()).map(t => t.trim()))]
      if (list.length) setTerms(list.sort((a, b) => a.localeCompare(b, 'en')))
      setStatus('')
    }).catch(e => { if (e.name !== 'AbortError') setStatus('Showing common terms. Scroll sideways and click to add a term.') })
    return () => ac.abort()
  }, [])
  const before = value.slice(0, cursor)
  const fragment = before.match(/[a-zA-Z][a-zA-Z_-]*$/)?.[0] || ''
  const suggestions = fragment && !/^(AND|OR|NOT)$/.test(fragment) ? terms.filter(t => t.toLowerCase().startsWith(fragment.toLowerCase())).slice(0, 8) : []
  function choose(term) {
    const end = cursor + (value.slice(cursor).match(/^[a-zA-Z_-]*/)?.[0].length || 0)
    const start = cursor - fragment.length
    const insertion = term.includes(' ') ? `"${term}" ` : `${term} `
    onChange(value.slice(0, start) + insertion + value.slice(end)); setOpen(false); setActive(-1)
    requestAnimationFrame(() => { input.current.focus(); input.current.setSelectionRange(start + insertion.length, start + insertion.length); setCursor(start + insertion.length) })
  }
  function insert(token) {
    const el = input.current; const start = el.selectionStart; const end = el.selectionEnd
    const text = `${start && !/\s/.test(value[start - 1]) ? ' ' : ''}${token} `
    onChange(value.slice(0, start) + text + value.slice(end)); setOpen(false)
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + text.length, start + text.length); setCursor(start + text.length) })
  }
  function chooseMarqueeTerm(term) {
    const word = /\s/.test(term) ? `"${term}"` : term
    const text = [value.trimEnd(), word].filter(Boolean).join(' ')

    onChange(text)
    setCursor(text.length)
    setActive(-1)
    setOpen(false)

    requestAnimationFrame(() => {
      input.current?.focus()
      input.current?.setSelectionRange(text.length, text.length)
      setOpen(false)
    })
  }
  return <><form className="search-form" onSubmit={e => {e.preventDefault(); if (value.trim()) {setOpen(false); onSearch(value.trim())}}}>
    <label htmlFor="query">Search studies and brain functions</label>
    <div className="search-row"><div className="search-input-wrap">
      <input id="query" ref={input} role="combobox" aria-autocomplete="list" aria-expanded={open && suggestions.length > 0} aria-controls="term-options" aria-activedescendant={open && active >= 0 ? `term-${active}` : undefined} autoComplete="off" value={value} placeholder="e.g. memory AND attention" onChange={e => {onChange(e.target.value); setCursor(e.target.selectionStart); setOpen(true); setActive(-1)}} onSelect={e => setCursor(e.target.selectionStart)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onKeyDown={e => {
        if (e.nativeEvent.isComposing) return
        if (e.key === 'Escape') {setOpen(false); setActive(-1)}
        if (open && suggestions.length && ['ArrowDown', 'ArrowUp'].includes(e.key)) {e.preventDefault(); setActive(a => (a + (e.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length)}
        if (e.key === 'Enter' && open && active >= 0 && suggestions[active]) {e.preventDefault(); choose(suggestions[active])}
      }} />
      {open && suggestions.length > 0 && <ul id="term-options" role="listbox" className="suggestions">{suggestions.map((t, i) => <li id={`term-${i}`} key={t} role="option" aria-selected={active === i} onMouseDown={e => e.preventDefault()} onClick={() => choose(t)}>{t}</li>)}</ul>}
    </div><button className="primary" disabled={!value.trim()}>Search</button></div>
    <div className="operators">{['AND','OR','NOT','(',')'].map(t => <button type="button" key={t} onClick={() => insert(t)}>{t}</button>)}<button type="button" className="quiet" onClick={() => {onChange(''); setOpen(false); input.current.focus()}}>Clear</button></div>
    {status && !terms.length && (
      <p className="muted" role="status">{status}</p>
    )}
  </form>
  {showMarquee && <TermMarquee terms={terms} onChoose={chooseMarqueeTerm} />}
  </>
}
