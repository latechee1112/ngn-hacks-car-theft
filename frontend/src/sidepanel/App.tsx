import { useState } from 'react'
import type { ExtractionResult } from '../types/page'

async function getActiveTabId(): Promise<number | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab?.id ?? null
}

function App() {
  const [status, setStatus] = useState<string>('')
  const [result, setResult] = useState<ExtractionResult | null>(null)

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

      <div style={{ display: 'flex', gap: 8 }}>
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
