import type { AnalyzeBackendResult } from '../types/analysis'

// Local dev backend. The fetch must happen here in the service worker, not in the
// content script — a content script's fetch Origin is the visited page's origin, not
// chrome-extension://<id>, so it wouldn't match the backend's CORS allowlist.
const BACKEND_URL = 'http://127.0.0.1:8000'
// Generous headroom over the backend's own LLM timeout (45s) plus network overhead -
// real pages send far more blocks than a quick manual test (a 100+ block Wikipedia
// page takes much longer for the LLM to classify than a tiny 4-block payload).
const ANALYZE_TIMEOUT_MS = 60000

chrome.runtime.onInstalled.addListener((details) => {
  console.log('[Distill] service worker installed')
  // First install only — walks the user through the calibration wizard in a
  // full tab (a popup is capped at ~600x800px, nowhere near "full screen").
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('calibration.html') }).catch(console.error)
  }
})

async function analyzePage(payload: unknown): Promise<AnalyzeBackendResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), ANALYZE_TIMEOUT_MS)

  try {
    const response = await fetch(`${BACKEND_URL}/v1/analyze-page`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      return { ok: false, error: `Backend returned ${response.status}: ${detail}` }
    }

    return { ok: true, data: await response.json() }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    clearTimeout(timeout)
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'DISTILL_ANALYZE_PAGE') {
    analyzePage(message.payload).then(sendResponse)
    return true // keep the message channel open for the async sendResponse
  }
  return true
})
