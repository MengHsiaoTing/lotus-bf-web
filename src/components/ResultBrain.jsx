import {useEffect,useMemo,useState} from 'react'
import {apiFetch} from '../api'
import {parseVolume,displayThreshold} from '../volume'
import {BrainViewer} from './BrainViewer'
import {SlicePicker} from './SlicePicker'

export function ResultBrain({query,radius=6}) {
  const [view,setView]=useState('2d'),[used3d,setUsed3d]=useState(false)
  const [rows,setRows]=useState(null),[error,setError]=useState('')
  const initial=query.match(/\[([^\]]+)\]/)?.[1].split(',').map(Number)
  const [point,setPoint]=useState(initial?.length===3&&initial.every(Number.isFinite)?initial:[0,0,0])
  const [enabled,setEnabled]=useState(false),[distribution,setDistribution]=useState(null),[mapError,setMapError]=useState('')
  const [mode,setMode]=useState('percentile'),[value,setValue]=useState(0),[percent,setPercent]=useState(95)
  const [alpha,setAlpha]=useState(0.4),[pointAlpha,setPointAlpha]=useState(1)
  useEffect(()=>{
    const ac=new AbortController();let active=true
    apiFetch(`/query/${encodeURIComponent(query)}/locations?limit=5000&offset=0&r=${radius}`,{signal:ac.signal}).then(async res=>{const data=await res.json();if(active)setRows(data.results||[])}).catch(e=>{if(active)setError(e.message)})
    return()=>{active=false;ac.abort()}
  },[query,radius])
  const points=useMemo(()=>{const unique=new Map();for(const row of rows||[]){const p=[row.x,row.y,row.z];if(p.every(Number.isFinite))unique.set(p.join(','),p)}return [...unique.values()]},[rows])
  useEffect(()=>{
    if(!enabled||distribution)return
    const ac=new AbortController();let active=true
    setMapError('')
    apiFetch(`/query/${encodeURIComponent(query)}/nii?r=${radius}&fwhm=10&kernel=gauss`,{signal:ac.signal}).then(async res=>{
      const volume=parseVolume(await (await res.blob()).arrayBuffer())
      const sorted=Array.from(volume.data,v=>v*volume.slope+volume.intercept).filter(v=>Number.isFinite(v)&&v>0).sort((a,b)=>a-b)
      if(active)setDistribution({volume,sorted})
    }).catch(e=>{if(active)setMapError(e.message)})
    return()=>{active=false;ac.abort()}
  },[query,radius,enabled,distribution])
  function switchView(next){setView(next);if(next==='3d')setUsed3d(true)}
  return <section className="result-brain">
    <div className="section-heading"><h2>Brain maps</h2><div className="brain-tabs" role="tablist" aria-label="Brain map view">
      {['2d','3d'].map((v,i)=><button type="button" key={v} id={`tab-${v}`} role="tab" aria-selected={view===v} aria-controls={`panel-${v}`} tabIndex={view===v?0:-1} onKeyDown={e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?'2d':e.key==='End'?'3d':i===0?'3d':'2d';switchView(next);document.getElementById(`tab-${next}`)?.focus()}}} onClick={()=>switchView(v)}>{v==='2d'?'2D slices':'3D brain'}</button>)}
    </div></div>
    {error&&<p className="error" role="alert">Could not load coordinates: {error}</p>}
    {rows===null&&!error&&<p role="status">Loading study coordinates…</p>}
    <div role="tabpanel" id="panel-2d" aria-labelledby="tab-2d" hidden={view!=='2d'} className="result-slices">
      <div className="slice-coordinate-fields">{['X','Y','Z'].map((axis,i)=><label key={axis}>{axis} (mm)<input type="number" step="1" value={point[i]} onChange={e=>{const n=Number(e.target.value);if(Number.isFinite(n))setPoint(old=>old.map((v,j)=>i===j?n:v))}}/></label>)}</div>
      <SlicePicker results point={point} onChange={setPoint} points={points} overlay={enabled?distribution?.volume:null} threshold={displayThreshold(distribution?.sorted||[],mode,value,percent)} overlayAlpha={alpha} pointAlpha={pointAlpha}/>
      {rows&&<p className="muted">{points.length} unique coordinates.{rows.length===5000?' Limited to the first 5,000 records; narrow your query for more complete results.':''}</p>}
      <label className="map-control">Point opacity <input type="range" min="0" max="1" step="0.05" value={pointAlpha} onChange={e=>setPointAlpha(Number(e.target.value))}/></label>
      <label className="map-control"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/> Show smoothed distribution (optional)</label>
      {enabled&&<div className="distribution-controls"><label>Display threshold <select value={mode} onChange={e=>setMode(e.target.value)}><option value="percentile">Percentile</option><option value="value">Value</option></select></label>
        {mode==='value'?<label>Value <input type="number" min="0" step="any" value={value} onChange={e=>setValue(e.target.value)}/></label>:<label>Percentile <input type="number" min="0" max="100" value={percent} onChange={e=>setPercent(e.target.value)}/></label>}
        <label>Distribution opacity <input type="range" min="0" max="1" step="0.05" value={alpha} onChange={e=>setAlpha(Number(e.target.value))}/></label>
        {!distribution&&!mapError&&<p role="status">Loading distribution…</p>}{distribution&&!distribution.sorted.length&&<p>No nonzero distribution values.</p>}{mapError&&<p role="alert">{mapError}</p>}
      </div>}
    </div>
    <div role="tabpanel" id="panel-3d" aria-labelledby="tab-3d" hidden={view!=='3d'}>
      {used3d&&rows&&<BrainViewer query={query} radius={radius} coordinateRows={rows} active={view==='3d'}/>}
    </div>
  </section>
}
