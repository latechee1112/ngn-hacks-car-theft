import { useEffect, useState } from 'react'
import type { ExtractionResult } from '../types/page'

async function getActiveTabId(): Promise<number | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab?.id ?? null
}

function App() {
  const [status, setStatus] = useState<string>('')
  const [result, setResult] = useState<ExtractionResult | null>(null)
  const [simplified, setSimplified] = useState(false)

  async function refreshStatus() {
    try {
      const tabId = await getActiveTabId()
      if (!tabId) return
      const response = (await chrome.tabs.sendMessage(tabId, { type: 'FOCUSFIT_STATUS' })) as {
        simplified: boolean
      }
      setSimplified(response.simplified)
    } catch {
      setSimplified(false)
    }
  }

  useEffect(() => {
    refreshStatus()
  }, [])

  async function pingActiveTab() {
    setStatus('Pinging content script...')
    setResult(null)
    try {
      const tabId = await getActiveTabId()
      if (!tabId) {
        setStatus('No active tab found')
        return
      }
      const response = await chrome.tabs.sendMessage(tabId, { type: 'FOCUSFIT_PING' })
      setStatus(`Content script responded: ${JSON.stringify(response)}`)
    } catch (err) {
      setStatus(`No response (content script not loaded on this page): ${String(err)}`)
    }
  }

  async function extractPage() {
    setStatus('Extracting page structure...')
    setResult(null)
    try {
      const tabId = await getActiveTabId()
      if (!tabId) {
        setStatus('No active tab found')
        return
      }
      const response = (await chrome.tabs.sendMessage(tabId, {
        type: 'FOCUSFIT_EXTRACT',
      })) as ExtractionResult
      setStatus(`Extracted ${response.blocks.length} blocks`)
      setResult(response)
    } catch (err) {
      setStatus(`Extraction failed: ${String(err)}`)
    }
  }

  async function simplifyPage() {
    setStatus('Simplifying page...')
    try {
      const tabId = await getActiveTabId()
      if (!tabId) {
        setStatus('No active tab found')
        return
      }
      const response = (await chrome.tabs.sendMessage(tabId, {
        type: 'FOCUSFIT_SIMPLIFY',
      })) as { primaryFound: boolean; deemphasizedCount: number }
      setSimplified(true)
      setStatus(
        response.primaryFound
          ? `Simplified. Main content detected, ${response.deemphasizedCount} clutter elements deemphasized.`
          : `Simplified. No <main>/<article> found, ${response.deemphasizedCount} clutter elements deemphasized.`,
      )
    } catch (err) {
      setStatus(`Simplification failed: ${String(err)}`)
    }
  }

  async function restorePage() {
    setStatus('Restoring original page...')
    try {
      const tabId = await getActiveTabId()
      if (!tabId) {
        setStatus('No active tab found')
        return
      }
      await chrome.tabs.sendMessage(tabId, { type: 'FOCUSFIT_RESTORE' })
      setSimplified(false)
      setStatus('Original page restored.')
    } catch (err) {
      setStatus(`Restore failed: ${String(err)}`)
    }
  }

  const counts = result
    ? result.blocks.reduce<Record<string, number>>((acc, block) => {
        acc[block.elementType] = (acc[block.elementType] || 0) + 1
        return acc
      }, {})
    : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h1 style={{ fontSize: 18, margin: 0 }}>FocusFit</h1>
      <p style={{ fontSize: 13, color: '#555', margin: 0 }}>Extension scaffold running.</p>

      {simplified && (
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: '#2e7d32',
            background: '#e8f5e9',
            padding: '6px 10px',
            borderRadius: 6,
          }}
        >
          Local simplification mode
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={simplifyPage} style={{ padding: '6px 12px' }} disabled={simplified}>
          Simplify page (local)
        </button>
        <button onClick={restorePage} style={{ padding: '6px 12px' }} disabled={!simplified}>
          Show original page
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={pingActiveTab} style={{ padding: '6px 12px' }}>
          Ping content script
        </button>
        <button onClick={extractPage} style={{ padding: '6px 12px' }}>
          Extract page structure
        </button>
      </div>

      {status && <p style={{ fontSize: 12, wordBreak: 'break-word', margin: 0 }}>{status}</p>}

      {result && (
        <div style={{ fontSize: 12 }}>
          {result.hasSensitiveForms && (
            <p style={{ color: '#b00020', fontWeight: 600 }}>
              ⚠ Sensitive form detected (password/payment) — this page will be excluded from
              backend requests.
            </p>
          )}
          {counts && (
            <ul style={{ paddingLeft: 16, margin: '4px 0' }}>
              {Object.entries(counts)
                .sort((a, b) => b[1] - a[1])
                .map(([type, count]) => (
                  <li key={type}>
                    {type}: {count}
                  </li>
                ))}
            </ul>
          )}
          <details>
            <summary style={{ cursor: 'pointer' }}>Raw blocks JSON</summary>
            <pre
              style={{
                maxHeight: 300,
                overflow: 'auto',
                background: '#eee',
                padding: 8,
                fontSize: 11,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {JSON.stringify(result.blocks, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  )
}

export default App
