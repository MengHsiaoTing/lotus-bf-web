// Same-origin API in production; Vite forwards to local Flask during development.
export async function apiFetch(path, { signal, timeout = 60000 } = {}) {
  const controller = new AbortController()
  let timedOut = false
  const abort = () => controller.abort()
  if (signal?.aborted) controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeout)
  try {
    const response = await fetch(path, { signal: controller.signal })
    // Read the body before clearing the timer: a stalled download also times out.
    const blob = await response.blob()
    if (!response.ok) {
      let message = `HTTP ${response.status}`
      try { message = JSON.parse(await blob.text()).error || message } catch { /* proxy HTML */ }
      throw new Error(message)
    }
    return { json: async () => JSON.parse(await blob.text()), blob: async () => blob, headers: response.headers }
  } catch (error) {
    if (timedOut) throw new Error('等待超過 60 秒，服務可能正在啟動，請稍後重新搜尋')
    throw error
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}
