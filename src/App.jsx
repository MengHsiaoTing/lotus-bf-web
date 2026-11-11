import { NeuralBackground } from './components/NeuralBackground'
import { useEffect, useState } from 'react'
import { SearchBox } from './components/SearchBox'
import { Studies } from './components/Studies'
import { BrainViewer } from './components/BrainViewer'
import './App.css'
import { ResultBrain } from './components/ResultBrain'
import { SlicePicker } from './components/SlicePicker'

function CoordinateSearch({ query, radius, onSearch, showPicker }) {
  const match = query.match(/^\[([^\]]+)\]$/)
  const [coords,setCoords] = useState(match ? match[1].split(',') : ['-20','0','20'])
  const [r,setR] = useState(radius)
  const point=coords.map(v=>Number(v)||0)
  function submit(event) {
    event.preventDefault()
    if (coords.some(v=>String(v).trim()==='') || !coords.map(Number).every(Number.isFinite)) return
    onSearch(`[${coords.map(Number).join(',')}]`,r)
  }
  return <>
    <form className="search-form" onSubmit={submit}>
      <p className="coordinate-label">MNI coordinates (mm)</p>
      <div className="coordinate-fields">
        {['X','Y','Z'].map((axis,i)=><label key={axis}>{axis}<input type="number" step="any" required value={coords[i]} onChange={e=>setCoords(old=>old.map((v,j)=>i===j?e.target.value:v))}/></label>)}
      </div>
      <label style={{display:'block',marginTop:16}}>Search radius (mm) <input type="number" min="0.1" max="50" step="0.1" required value={r} onChange={e=>setR(e.target.value)}/></label>
      <button type="submit" className="primary coordinate-submit">Search this location →</button>
      <p className="muted">Find studies with reported coordinates within the selected radius. Display thresholds do not filter studies.</p>
    </form>
    {showPicker && <section className="card" style={{marginTop:20}}><h2>Choose a location</h2>
      <SlicePicker point={point} onChange={p=>setCoords(p.map(String))}/>
    </section>}
  </>
}

const readRoute = () => {
  const params = new URLSearchParams(window.location.search)
  const q = params.get('q') || ''
  const mode = params.get('mode') === 'coordinates' || window.location.hash === '#coordinates' ? 'coordinates' : 'terms'
  const rawR = Number(params.get('r') || 6)
  const radius = Number.isFinite(rawR) && rawR >= 0.1 && rawR <= 50 ? rawR : 6
  return { q, mode, radius, page: q ? 'results' : ['#search','#coordinates'].includes(window.location.hash) ? 'search' : 'home' }
}
export default function App() {
  const [route, setRoute] = useState(readRoute)
  const [draft, setDraft] = useState(route.q)
  useEffect(() => {
    const sync = () => { const next = readRoute(); setRoute(next); setDraft(next.q) }
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [])
  function navigate(page, q = '', mode = 'terms', radius = 6) {
    const url = new URL(window.location.href)
    if (q) url.searchParams.set('q', q); else url.searchParams.delete('q')
    if (mode === 'coordinates' && page !== 'home') url.searchParams.set('mode', mode); else url.searchParams.delete('mode')
    if (mode === 'coordinates') url.searchParams.set('r', String(radius)); else url.searchParams.delete('r')
    url.hash = page === 'search' ? mode === 'coordinates' ? 'coordinates' : 'search' : ''
    window.history.pushState({}, '', url)
    setRoute({page, q, mode, radius:Number(radius), revision: Date.now()}); setDraft(q); window.scrollTo(0, 0)
  }
  return (
  <div className={`app ${route.page === 'home' ? 'app--home' : ''}`}>
    <header className="site-header">
      <button
        className="brand"
        onClick={() => navigate('home')}
      >
        LoTUS<span>–BF</span>
      </button>

      <span className="tagline">
        <span>Location-or-Term Unified Search for Brain Functions</span>
      </span>


    </header>
    {route.page === 'home' ? <main className="landing">
      <NeuralBackground />

      <div className="landing-content">
        <h1 className="eyebrow">
          EXPLORE THE HUMAN BRAIN
        </h1>

        <BrainViewer autoRotate />
        <p className="muted">Chrome, Edge or Firefox is recommended for the best 3D viewing experience.</p>

        <div className="entry-buttons" style={{display:'flex',justifyContent:'center',flexWrap:'wrap',gap:20}}>
          <button className="primary enter" onClick={() => navigate('search', '', 'terms')}>Term search</button>
          <button className="primary enter" onClick={() => navigate('search', '', 'coordinates')}>Coordinate search</button>
        </div>
      </div>
    </main> : <main className={route.page === 'search' ? 'search-page' : 'results-page'}>
      {route.page === 'search' && <>
        <h1 className="eyebrow" style={{fontSize:'clamp(22px, 3vw, 34px)',fontWeight:700,lineHeight:1.4,letterSpacing:'0.12em',margin:'0 0 20px'}}>{route.mode === 'coordinates' ? 'BRAIN LOCATION SEARCH' : 'BRAIN FUNCTION SEARCH'}</h1>
        <p className="intro">{route.mode === 'coordinates' ? 'Enter X, Y and Z or select a location on the slices.' : 'Enter keywords to find related studies.'}</p>
      </>}
      {route.mode === 'coordinates'
        ? <CoordinateSearch showPicker={route.page === 'search'} key={`${route.q}-${route.revision || 0}`} query={route.q} radius={route.radius} onSearch={(q,r) => navigate('results', q, 'coordinates',r)} />
        : <SearchBox value={draft} onChange={setDraft} onSearch={q => navigate('results', q, 'terms')} showMarquee={route.page === 'search'} />}

      {route.page === 'results' && <>
        <p className="query-caption">Search results: <strong>{route.q}</strong></p>
        <div className="results-grid"><section className="card"><Studies key={`${route.q}-${route.revision || 0}`} query={route.q} radius={route.radius} /></section><aside className="card brain-panel"><ResultBrain key={`${route.q}-${route.revision || 0}`} query={route.q} radius={route.radius}/></aside></div>
      </>}
    </main>}
  </div>
  )
}
