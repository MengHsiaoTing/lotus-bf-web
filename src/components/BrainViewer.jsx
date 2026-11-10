import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '../api'
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

export function BrainViewer({query = '', autoRotate = false}) {
  const canvas = useRef(null), viewer = useRef(null), container = useRef(null), enlarge = useRef(null)
  const [status, setStatus] = useState('載入大腦影像中…'), [error, setError] = useState('')
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
  const [opacity, setOpacity] = useState(0.7)
  const [anatomyOpacity, setAnatomyOpacity] = useState(0.7)
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
    async function load() {
      try {
        // Defer attachment so React StrictMode's discarded effect cannot own this canvas.
        await Promise.resolve(); if (disposed) return
        await nv.attachToCanvas(canvas.current, true)
        if (disposed) return
        viewer.current = nv; nv.setSliceType(nv.sliceTypeRender)
        observer = new ResizeObserver(() => {if (!disposed) nv.resizeListener()}); observer.observe(container.current)
        await nv.loadVolumes([
          autoRotate
            ? {
                // 入口：使用官網較細緻的腦圖
                url: `${import.meta.env.BASE_URL}static/mni152.nii.gz`,
                name: 'mni152.nii.gz',
                colormap: 'gray',
                cal_min: 30,
                cal_max: 80,
              }
            : {
                // 搜尋結果：保留原本的模板
                url: `${import.meta.env.BASE_URL}static/mni_2mm.nii.gz`,
                name: 'mni_2mm.nii.gz',
                colormap: 'gray',
              },
        ])
        if (disposed) return
        nv.setRenderAzimuthElevation(120, 15)
        if (autoRotate) {
          nv.setScale(1.25)
          await nv.setVolumeRenderIllumination(0)
          if (disposed) return
        }
        setStatus(query ? '載入搜尋結果圖層中…' : '')
        if (query) {
          const res = await apiFetch(`/query/${encodeURIComponent(query)}/nii?fwhm=10&kernel=gauss&r=6`, {signal: ac.signal})
          if (res.headers.get('X-Coordinate-Count') === '0') {
            if (!disposed) setStatus('此查詢沒有可顯示的腦部座標。')
            return
          }
          const blob = await res.blob(); if (disposed) return
          const url = URL.createObjectURL(blob); urls.push(url)
          await nv.addVolumeFromUrl({url, name:'query.nii.gz', colormap:'hot', opacity:0.7})
          if (disposed) return
          nv.setOpacity(0, 0.7)
          setStatus('')
        }
      } catch(e) {if (!disposed) {setError(`${e.message}；可繼續使用文獻搜尋。`); setStatus('')}}
      finally {loaded = true; if (disposed) nv.cleanup()}
    }
    load()
    return () => {disposed = true; ac.abort(); observer?.disconnect(); if (viewer.current === nv) viewer.current = null; if (loaded) nv.cleanup(); urls.forEach(url => URL.revokeObjectURL(url))}
  }, [query, autoRotate])
  useEffect(() => {
    if (!rotating) return
    let frame, last = 0
    const tick = now => {
      if (viewer.current && rotatingRef.current && !document.hidden && now-last > 40) {const nv = viewer.current; nv.setRenderAzimuthElevation((nv.scene.renderAzimuth + 0.45) % 360, nv.scene.renderElevation); last = now}
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame)
  }, [rotating])
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
  return <div ref={container} className={`brain-viewer ${expanded ? 'expanded' : ''}`} role={expanded ? 'dialog' : undefined} aria-modal={expanded ? true : undefined} aria-label="可旋轉的 3D 腦影像">
    <div className="brain-canvas"><canvas ref={canvas} tabIndex={0} style={{outline: 'none'}} aria-label="3D 大腦：單擊切換自動旋轉，拖曳調整視角，雙擊重設。鍵盤空白鍵切換旋轉，Home 重設。" title="單擊：旋轉／暫停；拖曳：調整視角；雙擊：重設" /></div>
    {status && <p className="brain-status" role="status">{status}</p>}{error && <p className="brain-status error" role="alert">{error}</p>}
    {!autoRotate && <div className="brain-tools"><button ref={enlarge} onClick={() => setExpanded(v => !v)}>{expanded ? '關閉放大 ×' : '放大檢視 ⤢'}</button></div>}
    {query && <label className="opacity">大腦透明度 <input type="range" min="0.1" max="1" step="0.05" value={anatomyOpacity} onChange={e => {setAnatomyOpacity(Number(e.target.value)); if (viewer.current?.volumes.length) viewer.current.setOpacity(0, Number(e.target.value))}} /></label>}
    {query && <label className="opacity">圖層透明度 <input type="range" min="0" max="1" step="0.05" value={opacity} onChange={e => {setOpacity(Number(e.target.value)); if (viewer.current?.volumes.length > 1) viewer.current.setOpacity(1, Number(e.target.value))}} /></label>}
  </div>
}
