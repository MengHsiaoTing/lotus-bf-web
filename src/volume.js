import * as nifti from 'nifti-reader-js'
const cache = new Map()
export function loadVolume(name) {
  if (!cache.has(name)) cache.set(name, (async () => {
    const res = await fetch(`${import.meta.env.BASE_URL}static/${name}`)
    if (!res.ok) throw new Error(`影像載入失敗 (${res.status})`)
    let buffer = await res.arrayBuffer()
    if (nifti.isCompressed(buffer)) buffer = nifti.decompress(buffer)
    const h = nifti.readHeader(buffer)
    if (!h) throw new Error('無效影像')
    const types = {2: Uint8Array, 4: Int16Array, 8: Int32Array, 16: Float32Array, 64: Float64Array, 256: Int8Array, 512: Uint16Array}
    if (!types[h.datatypeCode]) throw new Error('不支援的影像資料型態')
    const data = new types[h.datatypeCode](nifti.readImage(h, buffer))
    const a = h.affine, dims = h.dims.slice(1,4)
    // Bundled templates are axis aligned; refuse silent errors for oblique volumes.
    if (a.slice(0,3).some((row,i) => row.slice(0,3).some((v,j) => i !== j && Math.abs(v)>1e-5))) throw new Error('此影像需斜切座標轉換')
    return {data, dims, a, slope: h.scl_slope || 1, intercept: h.scl_inter || 0}
  })().catch(e => {cache.delete(name); throw e}))
  return cache.get(name)
}
export function sample(volume, xyz) {
  const {a,dims,data,slope,intercept} = volume
  const ijk = xyz.map((v,i) => Math.round((v-a[i][3])/a[i][i]))
  if (ijk.some((v,i) => v<0 || v>=dims[i])) return 0
  return data[ijk[0]+dims[0]*(ijk[1]+dims[1]*ijk[2])]*slope+intercept
}
