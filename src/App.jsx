import { NeuralBackground } from './components/NeuralBackground'
import { useEffect, useState } from 'react'
import { SearchBox } from './components/SearchBox'
import { Studies } from './components/Studies'
import { BrainViewer } from './components/BrainViewer'
import './App.css'

function CoordinateSearch({ query, onSearch }) {
  const match = query.match(/^\[([^\]]+)\]$/)
  const initial = match ? match[1].split(',') : ['', '', '']
  function submit(event) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const raw = ['x', 'y', 'z'].map(axis => String(data.get(axis) ?? '').trim())
    if (raw.some(value => !value)) return
    const values = raw.map(Number)
    if (!values.every(Number.isFinite)) return
    onSearch(`[${values.join(',')}]`)
  }
  return <form className="search-form" onSubmit={submit}>
    <p className="coordinate-label" style={{fontWeight:600}}>MNI 座標（mm）</p>
    <div className="coordinate-fields" style={{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:12}}>
      {['x','y','z'].map((axis,index) => <label key={axis} style={{display:'flex',flexDirection:'column',gap:8,minWidth:0}}>
        {axis.toUpperCase()}
        <input name={axis} type="number" step="any" required defaultValue={initial[index]}
          placeholder={['-22','0','-20'][index]}
          style={{width:'100%',minWidth:0,padding:'12px 8px',border:'1px solid #b8cdd7',borderRadius:8,fontSize:16}} />
      </label>)}
    </div>
    <button type="submit" className="primary coordinate-submit" style={{display:'block',margin:'20px auto 0',padding:'12px 28px'}}>搜尋此位置 →</button>
    <p className="muted">搜尋距離此 MNI 座標小於 6 mm、具有活化點的研究。</p>
  </form>
}

const readRoute = () => {
  const params = new URLSearchParams(window.location.search)
  const q = params.get('q') || ''
  const mode = params.get('mode') === 'coordinates' || window.location.hash === '#coordinates' ? 'coordinates' : 'terms'
  return { q, mode, page: q ? 'results' : ['#search','#coordinates'].includes(window.location.hash) ? 'search' : 'home' }
}
export default function App() {
  const [route, setRoute] = useState(readRoute)
  const [draft, setDraft] = useState(route.q)
  useEffect(() => {
    const sync = () => { const next = readRoute(); setRoute(next); setDraft(next.q) }
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [])
  function navigate(page, q = '', mode = 'terms') {
    const url = new URL(window.location.href)
    if (q) url.searchParams.set('q', q); else url.searchParams.delete('q')
    if (mode === 'coordinates' && page !== 'home') url.searchParams.set('mode', mode); else url.searchParams.delete('mode')
    url.hash = page === 'search' ? mode === 'coordinates' ? 'coordinates' : 'search' : ''
    window.history.pushState({}, '', url)
    setRoute({page, q, mode, revision: Date.now()}); setDraft(q); window.scrollTo(0, 0)
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

      {route.page === 'results' && (
        <button
          className="quiet"
          onClick={() => navigate('search', '', route.mode)}
        >
          新的搜尋
        </button>
      )}
    </header>
    {route.page === 'home' ? <main className="landing">
      <NeuralBackground />

      <div className="landing-content">
        <h1 className="eyebrow">
          EXPLORE THE HUMAN BRAIN
        </h1>

        <BrainViewer autoRotate />

        <div className="entry-buttons" style={{display:'flex',justifyContent:'center',flexWrap:'wrap',gap:20}}>
          <button className="primary enter" onClick={() => navigate('search', '', 'terms')}>詞彙查詢</button>
          <button className="primary enter" onClick={() => navigate('search', '', 'coordinates')}>座標查詢</button>
        </div>
      </div>
    </main> : <main className={route.page === 'search' ? 'search-page' : 'results-page'}>
      {route.page === 'search' && <>
        <h1 className="eyebrow" style={{fontSize:'clamp(22px, 3vw, 34px)',fontWeight:700,lineHeight:1.4,letterSpacing:'0.12em',margin:'0 0 20px'}}>{route.mode === 'coordinates' ? 'BRAIN LOCATION SEARCH' : 'BRAIN FUNCTION SEARCH'}</h1>
        <p className="intro">{route.mode === 'coordinates' ? '輸入 X、Y、Z，尋找此位置附近的相關研究。' : '輸入關鍵詞，尋找相關研究。'}</p>
      </>}
      {route.mode === 'coordinates'
        ? <CoordinateSearch key={`${route.q}-${route.revision || 0}`} query={route.q} onSearch={q => navigate('results', q, 'coordinates')} />
        : <SearchBox value={draft} onChange={setDraft} onSearch={q => navigate('results', q, 'terms')} showMarquee={route.page === 'search'} />}

      {route.page === 'results' && <>
        <p className="query-caption">搜尋結果：<strong>{route.q}</strong></p>
        <div className="results-grid"><section className="card"><Studies key={`${route.q}-${route.revision || 0}`} query={route.q} /></section><aside className="card brain-panel"><h2>3D 腦影像</h2><BrainViewer key={`${route.q}-${route.revision || 0}`} query={route.q} /><p className="muted">拖曳旋轉，滾輪縮放。彩色圖層為搜尋座標產生的平滑分布，並非統計顯著性圖。</p></aside></div>
      </>}
    </main>}
  </div>
  )
}
