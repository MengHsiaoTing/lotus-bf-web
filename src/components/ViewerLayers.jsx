import {useEffect,useState} from 'react'
import {apiFetch} from '../api'
import {loadVolume,sample} from '../volume'
export function ViewerLayers({nv,nodes,query,radius}) {
  const [maskOnly,setMaskOnly]=useState(false),[mask,setMask]=useState(null),[error,setError]=useState('')
  const [enabled,setEnabled]=useState(false),[map,setMap]=useState(null),[busy,setBusy]=useState(false)
  const [mode,setMode]=useState('percentile'),[value,setValue]=useState(0),[percent,setPercent]=useState(95)
  const [alpha,setAlpha]=useState(0.4)
  useEffect(()=>{let active=true;loadVolume('brain_mask.nii.gz').then(v=>{if(active)setMask(v)}).catch(e=>{if(active)setError(`遮罩：${e.message}`)});return()=>{active=false}},[])
  const filtered=maskOnly&&mask?nodes.filter(n=>sample(mask,[n.x,n.y,n.z])>0):nodes
  useEffect(()=>{
    const oldOpacity=nv.meshes[0]?.opacity ?? 1
    const selected=maskOnly&&mask?nodes.filter(n=>sample(mask,[n.x,n.y,n.z])>0):nodes
    if(selected.length) nv.loadConnectome({name:'文獻座標',nodes:selected,edges:[],nodeColormap:'red',nodeMinColor:0,nodeMaxColor:1,nodeScale:1.5,showLegend:false})
    else {nv.meshes=[];nv.drawScene()}
    if(nv.meshes.length)nv.setMeshProperty(nv.meshes[0].id,'opacity',oldOpacity)
  },[nv,nodes,maskOnly,mask])
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
    }).catch(e=>{if(active){setError(`分布圖：${e.message}`);setBusy(false)}}).finally(()=>{if(url)URL.revokeObjectURL(url)})
    return()=>{active=false;ac.abort()}
  },[enabled,map,nv,query,radius])
  useEffect(()=>{
    if(!map)return
    const {volume,sorted}=map
    const threshold=mode==='value'?Math.max(0,Number(value)||0):(sorted[Math.floor(Math.max(0,Math.min(100,Number(percent)||0))/100*Math.max(0,sorted.length-1))]||0)
    volume.cal_min=threshold;volume.cal_max=Math.max(threshold+1e-6,sorted.at(-1)||1)
    volume.opacity=enabled?alpha:0;volume.colormapType=0
    nv.updateGLVolume();nv.drawScene()
  },[map,mode,value,percent,enabled,alpha,nv])
  return <div style={{padding:14,fontSize:13}}>
    <label><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>顯示平滑分布圖層（可選）</label>
    {enabled&&<div style={{display:'flex',gap:10,flexWrap:'wrap',marginTop:12}}>
      <label>圖層顯示門檻 <select value={mode} onChange={e=>setMode(e.target.value)}><option value="value">Value</option><option value="percentile">Percentile</option></select></label>
      {mode==='value'?<label>Value <input type="number" min="0" step="any" value={value} onChange={e=>setValue(e.target.value)}/></label>:<label>Percentile <input type="number" min="0" max="100" value={percent} onChange={e=>setPercent(e.target.value)}/></label>}
      <label>分布圖透明度 <input type="range" min="0" max="1" step="0.05" value={alpha} onChange={e=>setAlpha(Number(e.target.value))}/></label>
      {map&&!map.sorted.length&&<p>此查詢沒有非零分布圖資料。</p>}
    </div>}
    {busy&&<p role="status">載入分布圖…</p>}{error&&<p role="alert">{error}</p>}
  </div>
}
