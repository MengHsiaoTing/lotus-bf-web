import * as nifti from 'nifti-reader-js'
const cache = new Map()
export function parseVolume(buffer) {
  if (nifti.isCompressed(buffer)) buffer = nifti.decompress(buffer)
  const h = nifti.readHeader(buffer)
  if (!h) throw new Error('Invalid NIfTI image.')
  const types = {2: Uint8Array, 4: Int16Array, 8: Int32Array, 16: Float32Array, 64: Float64Array, 256: Int8Array, 512: Uint16Array}
  if (!types[h.datatypeCode]) throw new Error('Unsupported image data type.')
  const data = new types[h.datatypeCode](nifti.readImage(h, buffer))
  const a = h.affine, dims = h.dims.slice(1,4)
  if (a.slice(0,3).some((row,i) => row.slice(0,3).some((v,j) => i !== j && Math.abs(v)>1e-5))) throw new Error('This image requires an oblique coordinate transform.')
  return {data, dims, a, slope: h.scl_slope || 1, intercept: h.scl_inter || 0}
}
export function loadVolume(name) {
  if (!cache.has(name)) cache.set(name, (async () => {
    const res = await fetch(`${import.meta.env.BASE_URL}static/${name}`)
    if (!res.ok) throw new Error(`Image request failed (${res.status}).`)
    return parseVolume(await res.arrayBuffer())
  })().catch(e => {cache.delete(name); throw e}))
  return cache.get(name)
}
export function sample(volume, xyz) {
  const {a,dims,data,slope,intercept} = volume
  const ijk = xyz.map((v,i) => Math.round((v-a[i][3])/a[i][i]))
  if (ijk.some((v,i) => !Number.isFinite(v) || v<0 || v>=dims[i])) return 0
  return data[ijk[0]+dims[0]*(ijk[1]+dims[1]*ijk[2])]*slope+intercept
}
export function volumeBounds(volume) {
  return [0,1,2].map(i=>[volume.a[i][3],volume.a[i][3]+volume.a[i][i]*(volume.dims[i]-1)].sort((a,b)=>a-b))
}
export function sliceLocation(point,plane,bounds,x,y) {
  const p=[...point], [loH,hiH]=bounds[plane.h], [loV,hiV]=bounds[plane.v]
  p[plane.h]=Math.round(loH+Math.max(0,Math.min(1,x))*(hiH-loH))
  p[plane.v]=Math.round(hiV-Math.max(0,Math.min(1,y))*(hiV-loV))
  return p
}
export function displayThreshold(sorted,mode,value,percent) {
  return mode==='value' ? Math.max(0,Number(value)||0) : (sorted[Math.floor(Math.max(0,Math.min(100,Number(percent)||0))/100*Math.max(0,sorted.length-1))]||0)
}
