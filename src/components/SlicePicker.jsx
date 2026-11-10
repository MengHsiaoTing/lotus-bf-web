import {useEffect,useRef,useState} from 'react'
import {loadVolume,sample} from '../volume'
const planes = [{title:'冠狀 Coronal (Y)',h:0,v:2,f:1},{title:'矢狀 Sagittal (X)',h:1,v:2,f:0},{title:'軸向 Axial (Z)',h:0,v:1,f:2}]
function Slice({volume,point,onChange,plane}) {
  const ref=useRef(null), size=240
  const {a,dims}=volume
  const bounds=[0,1,2].map(i=>[a[i][3],a[i][3]+a[i][i]*(dims[i]-1)].sort((x,y)=>x-y))
  const [loH,hiH]=bounds[plane.h], [loV,hiV]=bounds[plane.v]
  useEffect(()=>{
    const ctx=ref.current.getContext('2d'), img=ctx.createImageData(size,size)
    for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
      const xyz=[...point];xyz[plane.h]=loH+x/(size-1)*(hiH-loH);xyz[plane.v]=hiV-y/(size-1)*(hiV-loV)
      const val=Math.max(0,Math.min(255,sample(volume,xyz)/100*255)), i=(y*size+x)*4
      img.data.set([val,val,val,255],i)
    }
    ctx.putImageData(img,0,0);ctx.strokeStyle='#3de3c6';ctx.lineWidth=1
    const x=(point[plane.h]-loH)/(hiH-loH)*(size-1),y=(hiV-point[plane.v])/(hiV-loV)*(size-1)
    ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,size);ctx.moveTo(0,y);ctx.lineTo(size,y);ctx.stroke()
  },[volume,point,plane,loH,hiH,loV,hiV])
  function select(e){const r=e.currentTarget.getBoundingClientRect(),p=[...point];p[plane.h]=Math.round(loH+(e.clientX-r.left)/r.width*(hiH-loH));p[plane.v]=Math.round(hiV-(e.clientY-r.top)/r.height*(hiV-loV));onChange(p)}
  return <div><p>{plane.title}</p><canvas width={size} height={size} ref={ref} onPointerDown={select} style={{width:'100%',aspectRatio:`${hiH-loH}/${hiV-loV}`,cursor:'crosshair',display:'block'}} aria-label={`${plane.title}；亦可使用上方 XYZ 欄位選擇位置`}/></div>
}
export function SlicePicker({point,onChange}) {
  const [volume,setVolume]=useState(null),[error,setError]=useState('')
  useEffect(()=>{let active=true;loadVolume('mni152.nii.gz').then(v=>{if(active)setVolume(v)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[])
  if(error)return <p role="alert">{error}</p>
  if(!volume)return <p>載入三剖面…</p>
  return <><p className="muted">點選任一剖面帶入座標，再按搜尋。畫面左側為較小的 X／Y 值。</p><div style={{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:12}}>{planes.map(p=><Slice key={p.f} volume={volume} point={point} onChange={onChange} plane={p}/>)}</div></>
}
