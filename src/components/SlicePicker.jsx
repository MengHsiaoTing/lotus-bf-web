import {useEffect,useRef,useState} from 'react'
import {loadVolume,sample,volumeBounds,sliceLocation} from '../volume'
const planes = [{title:'Coronal (Y)',h:0,v:2,f:1,left:'L',right:'R'},{title:'Sagittal (X)',h:1,v:2,f:0,left:'P',right:'A'},{title:'Axial (Z)',h:0,v:1,f:2,left:'L',right:'R'}]
const emptyPoints=[]
function Slice({volume,point,onChange,plane,points,overlay,threshold,overlayAlpha,pointAlpha}) {
  const ref=useRef(null), size=280
  const bounds=volumeBounds(volume)
  const [loH,hiH]=bounds[plane.h], [loV,hiV]=bounds[plane.v]
  const aspect=(hiH-loH)/(hiV-loV)
  useEffect(()=>{
    const ctx=ref.current.getContext('2d'), img=ctx.createImageData(size,size)
    for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
      const xyz=[...point];xyz[plane.h]=loH+x/(size-1)*(hiH-loH);xyz[plane.v]=hiV-y/(size-1)*(hiV-loV)
      const val=Math.max(0,Math.min(255,sample(volume,xyz)/100*255)), i=(y*size+x)*4
      const hot=overlay?sample(overlay,xyz):0
      const alpha=hot>0&&hot>=threshold?overlayAlpha:0
      img.data.set([val*(1-alpha)+255*alpha,val*(1-alpha)+255*alpha,val*(1-alpha),255],i)
    }
    ctx.putImageData(img,0,0)
    ctx.globalAlpha=pointAlpha;ctx.fillStyle='#ff3030'
    for(const p of points){
      // A 4 mm slab centered on the selected plane; no brain mask or projection to the surface.
      if(Math.abs(p[plane.f]-point[plane.f])>2)continue
      const x=(p[plane.h]-loH)/(hiH-loH)*(size-1),y=(hiV-p[plane.v])/(hiV-loV)*(size-1)
      ctx.beginPath();ctx.ellipse(x,y,1.5/(hiH-loH)*size,1.5/(hiV-loV)*size,0,0,Math.PI*2);ctx.fill()
    }
    ctx.globalAlpha=1;ctx.strokeStyle='#3de3c6';ctx.lineWidth=1
    const x=(point[plane.h]-loH)/(hiH-loH)*(size-1),y=(hiV-point[plane.v])/(hiV-loV)*(size-1)
    ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,size);ctx.moveTo(0,y);ctx.lineTo(size,y);ctx.stroke()
    ctx.fillStyle='white';ctx.font='14px sans-serif';ctx.fillText(plane.left,6,size/2);ctx.fillText(plane.right,size-17,size/2)
  },[volume,point,plane,loH,hiH,loV,hiV,points,overlay,threshold,overlayAlpha,pointAlpha])
  function select(e){const r=e.currentTarget.getBoundingClientRect();onChange(sliceLocation(point,plane,bounds,(e.clientX-r.left)/r.width,(e.clientY-r.top)/r.height))}
  return <div><p>{plane.title}</p><div className="slice-frame"><canvas width={size} height={size} ref={ref} onPointerDown={select} style={{width:`${Math.min(1,aspect)*100}%`,height:`${Math.min(1,1/aspect)*100}%`,cursor:'crosshair',display:'block'}} aria-label={`${plane.title}. Use the coordinate fields or slider for keyboard selection.`}/></div>
    <input className="slice-slider" aria-label={`${plane.title} slice position`} type="range" min={Math.ceil(bounds[plane.f][0])} max={Math.floor(bounds[plane.f][1])} step="1" value={point[plane.f]} onChange={e=>onChange(point.map((v,i)=>i===plane.f?Number(e.target.value):v))}/>
  </div>
}
export function SlicePicker({point,onChange,points=emptyPoints,overlay=null,threshold=0,overlayAlpha=0.4,pointAlpha=1,results=false}) {
  const [volume,setVolume]=useState(null),[error,setError]=useState('')
  useEffect(()=>{let active=true;loadVolume('mni152.nii.gz').then(v=>{if(active)setVolume(v)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[])
  if(error)return <p role="alert">{error}</p>
  if(!volume)return <p role="status">Loading slices…</p>
  return <><p className="muted">{results?'Click a slice or adjust the coordinates to explore. Points within 2 mm of each slice are shown.':'Click a slice to set the coordinates, then select Search this location.'}</p><div className="slice-grid">{planes.map(p=><Slice key={p.f} volume={volume} point={point} onChange={onChange} plane={p} points={points} overlay={overlay} threshold={threshold} overlayAlpha={overlayAlpha} pointAlpha={pointAlpha}/>)}</div></>
}
