import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '../api'
import { ViewerLayers } from './ViewerLayers'
import { Niivue } from '@niivue/niivue'

// Keep click, drag and double-click separate without blocking NiiVue's drag handlers.
function installBrainGestures(element, { toggle, pause, reset }) {
  const threshold = 6
  let gesture = null
  let pendingClick = null
  let previousClick = null
  let lastWasDrag = false
  const clearClick = () => {
    clearTimeout(pendingClick)
    pendingClick = null
  }
  const cancel = () => {
    gesture = null
    previousClick = null
    lastWasDrag = true
    clearClick()
  }
  const down = event => {
    if (!event.isPrimary) { cancel(); pause(); return }
    if (event.button !== 0) { cancel(); pause(); return }
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY,
      started: performance.now(), moved: false }
    lastWasDrag = false
    element.setPointerCapture?.(event.pointerId)
  }
  const move = event => {
    if (!gesture || gesture.id !== event.pointerId) return
    if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > threshold) {
      gesture.moved = true
      lastWasDrag = true
      previousClick = null
      clearClick()
      pause()
    }
  }
  const up = event => {
    if (!gesture || gesture.id !== event.pointerId) return
    move(event)
    const current = gesture
    gesture = null
    const rect = element.getBoundingClientRect()
    const outside = event.clientX < rect.left || event.clientX > rect.right ||
      event.clientY < rect.top || event.clientY > rect.bottom
    if (current.moved || outside || performance.now() - current.started > 500) {
      cancel()
      return
    }
    const now = performance.now()
    if (previousClick && now - previousClick.time < 350 &&
      Math.hypot(event.clientX - previousClick.x, event.clientY - previousClick.y) < 12) {
      clearClick()
      previousClick = null
      reset()
      return
    }
    previousClick = { time: now, x: event.clientX, y: event.clientY }
    clearClick()
    pendingClick = setTimeout(() => {
      pendingClick = null
      toggle()
    }, 350)
  }
  const doubleClick = event => {
    // NiiVue also binds dblclick to contrast reset; intercept it before that handler.
    event.preventDefault()
    event.stopImmediatePropagation()
    clearClick()
    previousClick = null
    if (!lastWasDrag) reset()
  }
  const key = event => {
    if (![' ', 'Enter', 'Home'].includes(event.key)) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (event.repeat) return
    clearClick()
    previousClick = null
    if (event.key === 'Home') reset()
    else toggle()
  }
  const wheel = () => { cancel(); pause() }
  const events = { pointerdown: down, pointermove: move, pointerup: up,
    pointercancel: cancel, dblclick: doubleClick, keydown: key, wheel }
  for (const [type, handler] of Object.entries(events)) {
    element.addEventListener(type, handler, true)
  }
  window.addEventListener('blur', cancel)
  return () => {
    clearClick()
    for (const [type, handler] of Object.entries(events)) {
      element.removeEventListener(type, handler, true)
    }
    window.removeEventListener('blur', cancel)
  }
}

export function BrainViewer({query = '', autoRotate = false, radius = 6, coordinateRows = null, active = true}) {
  const canvas = useRef(null), viewer = useRef(null), container = useRef(null), enlarge = useRef(null)
  const [status, setStatus] = useState('Loading brain image…'), [error, setError] = useState('')
  const [expanded, setExpanded] = useState(false), [rotating, setRotating] = useState(autoRotate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const rotatingRef = useRef(rotating)
  useEffect(() => {
    const changeRotation = value => {
      rotatingRef.current = value
      setRotating(value)
    }
    return installBrainGestures(canvas.current, {
      toggle: () => changeRotation(!rotatingRef.current),
      pause: () => changeRotation(false),
      reset: () => {
        changeRotation(false)
        viewer.current?.setRenderAzimuthElevation(120, 15)
        viewer.current?.setScale(autoRotate ? 1.25 : 1)
      },
    })
  }, [autoRotate])
  const [layerData,setLayerData]=useState(null)
  const [opacity, setOpacity] = useState(1)
  const [anatomyOpacity, setAnatomyOpacity] = useState(0.35)
  useEffect(() => {
    let disposed = false, loaded = false
    const ac = new AbortController(), urls = []
    const nv = new Niivue({
      // 入口透明，讓後面的神經網絡可以透出
      backColor: autoRotate
        ? [0, 0, 0, 0]
        : [0.035, 0.075, 0.13, 1],

      show3Dcrosshair: false,
      isColorbar: false,

      // 入口不顯示左下角的方向方塊
      isOrientCube: !autoRotate,

      // 依螢幕像素密度繪製
      isResizeCanvas: true,
      forceDevicePixelRatio: 1,
    })
    let observer
    const element=canvas.current
    const contextLost=()=>{if(!disposed){setError('The 3D graphics connection was lost. Use 2D slices or try another browser.');setStatus('')}}
    element.addEventListener('webglcontextlost',contextLost)
    async function load() {
      try {
        // Defer attachment so React StrictMode's discarded effect cannot own this canvas.
        await Promise.resolve(); if (disposed) return
        await nv.attachToCanvas(canvas.current, true)
        if (disposed) return
        viewer.current = nv; nv.setSliceType(nv.sliceTypeRender)
        observer = new ResizeObserver(() => {if (!disposed) nv.resizeListener()}); observer.observe(container.current)
        await nv.loadVolumes([{
          url: `${import.meta.env.BASE_URL}static/mni152.nii.gz`,
          name: 'mni152.nii.gz', colormap: 'gray', cal_min: 30, cal_max: 80,
        }])
        if (disposed) return
        nv.setRenderAzimuthElevation(120, 15)
        if (autoRotate) {
          nv.setScale(1.25)
          await nv.setVolumeRenderIllumination(0)
          if (disposed) return
        }
        setStatus(query ? 'Loading study coordinates…' : '')
        if (query) {
          // Coordinates remain in their original world (MNI millimetre) positions.
          let rows = coordinateRows
          if (!rows) {
            const res = await apiFetch(`/query/${encodeURIComponent(query)}/locations?limit=5000&offset=0&r=${radius}`, {signal: ac.signal})
            rows = (await res.json()).results || []
          }
          if (disposed) return
          const unique = new Map()
          for (const row of rows) {
            const point = [row.x, row.y, row.z]
            if (point.every(v => typeof v === 'number' && Number.isFinite(v))) {
              unique.set(point.join(','), point)
            }
          }
          const nodes = [...unique.values()].map(([x,y,z]) => ({
            name: '', x, y, z, colorValue: 1, sizeValue: 1,
          }))
          setLayerData({nv,nodes})
          nv.setOpacity(0, 0.35)
          setAnatomyOpacity(0.35); setOpacity(1)
          setStatus(nodes.length ? `${nodes.length} unique coordinates. ${rows.length === 5000 ? 'Limited to the first 5,000 coordinate records. Narrow your query to see more complete results.' : ''}` : 'No coordinates available for this query.')
        }
      } catch(e) {if (!disposed) {setError(`${e.message}. Study search is still available.`); setStatus('')}}
      finally {loaded = true; if (disposed) nv.cleanup()}
    }
    load()
    return () => {disposed = true; element.removeEventListener('webglcontextlost',contextLost); ac.abort(); observer?.disconnect(); if (viewer.current === nv) viewer.current = null; if (loaded) nv.cleanup(); urls.forEach(url => URL.revokeObjectURL(url))}
  }, [query, autoRotate, radius, coordinateRows])
  useEffect(() => {
    if (!rotating || !active) return
    let frame, last = 0
    const tick = now => {
      if (viewer.current && rotatingRef.current && !document.hidden && now-last > 40) {const nv = viewer.current; nv.setRenderAzimuthElevation((nv.scene.renderAzimuth + 0.45) % 360, nv.scene.renderElevation); last = now}
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame)
  }, [rotating, active])
  useEffect(() => { if (active) viewer.current?.resizeListener() }, [active])
  useEffect(() => {
    if (!expanded) return
    const old = document.body.style.overflow; document.body.style.overflow = 'hidden'
    const previous = document.activeElement
    const buttons = () => [...container.current.querySelectorAll('canvas,button,input')]
    buttons()[0]?.focus()
    const key = e => {
      if (e.key === 'Escape') setExpanded(false)
      if (e.key === 'Tab') {const items = buttons(), first = items[0], last = items.at(-1); if (e.shiftKey && document.activeElement === first) {e.preventDefault(); last.focus()} else if (!e.shiftKey && document.activeElement === last) {e.preventDefault(); first.focus()}}
    }
    document.addEventListener('keydown', key)
    return () => {document.body.style.overflow = old; document.removeEventListener('keydown', key); previous?.focus()}
  }, [expanded])
  return <div ref={container} className={`brain-viewer ${expanded ? 'expanded' : ''}`} role={expanded ? 'dialog' : undefined} aria-modal={expanded ? true : undefined} aria-label="Interactive 3D brain">
    <div className="brain-canvas"><canvas ref={canvas} tabIndex={0} style={{outline: 'none'}} aria-label="3D brain: click to toggle rotation, drag to rotate, double-click to reset. Space toggles rotation; Home resets the view." title="Click: rotate/pause; drag: change view; double-click: reset" /></div>
    {status && <p className="brain-status" role="status">{status}</p>}{error && <p className="brain-status error" role="alert">{error}</p>}
    {!autoRotate && <div className="brain-tools"><button ref={enlarge} onClick={() => setExpanded(v => !v)}>{expanded ? 'Close expanded view ×' : 'Expand ⤢'}</button></div>}
    {query && layerData && <ViewerLayers key={`${query}-${radius}`} nv={layerData.nv} nodes={layerData.nodes} query={query} radius={radius}/>}
    {query && <label className="opacity">Brain opacity <input type="range" min="0.1" max="1" step="0.05" value={anatomyOpacity} onChange={e => {setAnatomyOpacity(Number(e.target.value)); if (viewer.current?.volumes.length) viewer.current.setOpacity(0, Number(e.target.value))}} /></label>}
    {query && <label className="opacity">Point opacity <input type="range" min="0" max="1" step="0.05" value={opacity} onChange={e => {setOpacity(Number(e.target.value)); if (viewer.current?.meshes.length) viewer.current.setMeshProperty(viewer.current.meshes[0].id, 'opacity', Number(e.target.value))}} /></label>}
  </div>
}
