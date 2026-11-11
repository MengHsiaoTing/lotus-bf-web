import {useEffect,useState} from 'react'
import {apiFetch} from '../api'
import {displayThreshold} from '../volume'
export function ViewerLayers({nv,nodes,query,radius}) {
  const [error,setError]=useState('')
  const [enabled,setEnabled]=useState(false),[map,setMap]=useState(null),[busy,setBusy]=useState(false)
  const [mode,setMode]=useState('percentile'),[value,setValue]=useState(0),[percent,setPercent]=useState(95)
  const [alpha,setAlpha]=useState(0.4)
  useEffect(()=>{
    const oldOpacity=nv.meshes[0]?.opacity ?? 1
    const selected=nodes
    if(selected.length) nv.loadConnectome({name:'Study coordinates',nodes:selected,edges:[],nodeColormap:'red',nodeMinColor:0,nodeMaxColor:1,nodeScale:1.5,showLegend:false})
    else {nv.meshes=[];nv.drawScene()}
    if(nv.meshes.length)nv.setMeshProperty(nv.meshes[0].id,'opacity',oldOpacity)
  },[nv,nodes])
  useEffect(()=>{
    if(!enabled||map)return
    let active=true,url;const ac=new AbortController()
    setBusy(true);setError('')
    apiFetch(`/query/${encodeURIComponent(query)}/nii?r=${radius}&fwhm=10&kernel=gauss`,{signal:ac.signal}).then(async res=>{
      const blob=await res.blob();if(!active)return
      url=URL.createObjectURL(blob)
      const volume=await nv.addVolumeFromUrl({url,name:'distribution.nii.gz',colormap:'red',opacity:0})
      if(!active){nv.removeVolume(volume);return}
      const sorted=Array.from(volume.img,v=>Number(v)*(volume.hdr.scl_slope||1)+(volume.hdr.scl_inter||0)).filter(v=>Number.isFinite(v)&&v>0).sort((a,b)=>a-b)
      setMap({volume,sorted});setBusy(false)
    }).catch(e=>{if(active){setError(`Distribution: ${e.message}`);setBusy(false)}}).finally(()=>{if(url)URL.revokeObjectURL(url)})
    return()=>{active=false;ac.abort()}
  },[enabled,map,nv,query,radius])
  useEffect(()=>{
    if(!map)return
    const {volume,sorted}=map
    const threshold=displayThreshold(sorted,mode,value,percent)
    volume.cal_min=threshold;volume.cal_max=Math.max(threshold+1e-6,sorted.at(-1)||1)
    volume.opacity=enabled?alpha:0;volume.colormapType=0
    nv.updateGLVolume();nv.drawScene()
  },[map,mode,value,percent,enabled,alpha,nv])
  return <div style={{padding:14,fontSize:13}}>
    <label><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>Show smoothed distribution (optional)</label>
    {enabled&&<div style={{display:'flex',gap:10,flexWrap:'wrap',marginTop:12}}>
      <label>Display threshold <select value={mode} onChange={e=>setMode(e.target.value)}><option value="value">Value</option><option value="percentile">Percentile</option></select></label>
      {mode==='value'?<label>Value <input type="number" min="0" step="any" value={value} onChange={e=>setValue(e.target.value)}/></label>:<label>Percentile <input type="number" min="0" max="100" value={percent} onChange={e=>setPercent(e.target.value)}/></label>}
      <label>Distribution opacity <input type="range" min="0" max="1" step="0.05" value={alpha} onChange={e=>setAlpha(Number(e.target.value))}/></label>
      {map&&!map.sorted.length&&<p>No nonzero distribution values.</p>}
    </div>}
    {busy&&<p role="status">Loading distribution…</p>}{error&&<p role="alert">{error}</p>}
  </div>
}
