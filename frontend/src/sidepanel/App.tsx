import { useState } from 'react'

function App() {
  const [pingResult, setPingResult] = useState<string>('')

  async function pingActiveTab() {
    setPingResult('Pinging content script...')
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id) {
        setPingResult('No active tab found')
        return
      }
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'FOCUSFIT_PING' })
      setPingResult(`Content script responded: ${JSON.stringify(response)}`)
    } catch (err) {
      setPingResult(`No response (content script not loaded on this page): ${String(err)}`)
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 18, marginBottom: 4 }}>FocusFit</h1>
      <p style={{ fontSize: 13, color: '#555', marginTop: 0 }}>Extension scaffold running.</p>
      <button onClick={pingActiveTab} style={{ padding: '6px 12px' }}>
        Ping active tab's content script
      </button>
      {pingResult && (
        <p style={{ fontSize: 12, marginTop: 12, wordBreak: 'break-word' }}>{pingResult}</p>
      )}
    </div>
  )
}

export default App
