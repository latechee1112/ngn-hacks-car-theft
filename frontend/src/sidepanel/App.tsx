import { useEffect, useState } from 'react'
import ToggleSwitch from './ToggleSwitch'

async function getActiveTabId(): Promise<number | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab?.id ?? null
}

const EXTENSION_VERSION = chrome.runtime.getManifest().version

function Icon({ name, className = '' }: { name: string; className?: string }) {
  return <span className={`material-symbols-outlined ${className}`}>{name}</span>
}

function App() {
  const [simplified, setSimplified] = useState(false)
  const [colorReductionAvailable, setColorReductionAvailable] = useState(false)
  const [colorReductionActive, setColorReductionActive] = useState(false)
  const [progressiveRevealAvailable, setProgressiveRevealAvailable] = useState(false)
  const [progressiveRevealActive, setProgressiveRevealActive] = useState(false)
  const [error, setError] = useState<string>('')

  async function refreshStatus() {
    try {
      const tabId = await getActiveTabId()
      if (!tabId) return
      const response = (await chrome.tabs.sendMessage(tabId, { type: 'DISTILL_STATUS' })) as {
        simplified: boolean
        colorReductionAvailable: boolean
        colorReductionActive: boolean
        progressiveRevealAvailable: boolean
        progressiveRevealActive: boolean
      }
      setSimplified(response.simplified)
      setColorReductionAvailable(response.colorReductionAvailable)
      setColorReductionActive(response.colorReductionActive)
      setProgressiveRevealAvailable(response.progressiveRevealAvailable)
      setProgressiveRevealActive(response.progressiveRevealActive)
    } catch {
      setSimplified(false)
      setColorReductionAvailable(false)
      setColorReductionActive(false)
      setProgressiveRevealAvailable(false)
      setProgressiveRevealActive(false)
    }
  }

  useEffect(() => {
    refreshStatus()
  }, [])

  async function simplifyPage() {
    setError('')
    try {
      const tabId = await getActiveTabId()
      if (!tabId) {
        setError('No active tab found')
        return
      }
      const response = (await chrome.tabs.sendMessage(tabId, {
        type: 'DISTILL_SIMPLIFY',
      })) as { primaryFound: boolean; deemphasizedCount: number }
      setSimplified(true)
      setColorReductionAvailable(response.primaryFound)
      setProgressiveRevealAvailable(response.primaryFound)
    } catch (err) {
      setError(`Couldn't simplify this page: ${String(err)}`)
    }
  }

  async function restorePage() {
    setError('')
    try {
      const tabId = await getActiveTabId()
      if (!tabId) {
        setError('No active tab found')
        return
      }
      await chrome.tabs.sendMessage(tabId, { type: 'DISTILL_RESTORE' })
      setSimplified(false)
      setColorReductionAvailable(false)
      setColorReductionActive(false)
      setProgressiveRevealAvailable(false)
      setProgressiveRevealActive(false)
    } catch (err) {
      setError(`Couldn't restore this page: ${String(err)}`)
    }
  }

  async function toggleColorReduction(enabled: boolean) {
    setError('')
    try {
      const tabId = await getActiveTabId()
      if (!tabId) {
        setError('No active tab found')
        return
      }
      const response = (await chrome.tabs.sendMessage(tabId, {
        type: 'DISTILL_SET_COLOR_REDUCTION',
        enabled,
      })) as { applied: boolean; active: boolean }
      setColorReductionActive(response.active)
    } catch (err) {
      setError(`Couldn't toggle color reduction: ${String(err)}`)
    }
  }

  async function toggleProgressiveReveal(enabled: boolean) {
    setError('')
    try {
      const tabId = await getActiveTabId()
      if (!tabId) {
        setError('No active tab found')
        return
      }
      const response = (await chrome.tabs.sendMessage(tabId, {
        type: 'DISTILL_SET_PROGRESSIVE_REVEAL',
        enabled,
      })) as { applied: boolean; active: boolean }
      setProgressiveRevealActive(response.active)
      if (enabled && !response.applied) {
        setError('Not enough sections to paginate — showing full article.')
      }
    } catch (err) {
      setError(`Couldn't toggle progressive reveal: ${String(err)}`)
    }
  }

  return (
    <div className="relative mx-auto flex h-screen w-full max-w-[400px] flex-col overflow-hidden border-x border-outline bg-background">
      <header className="flex w-full shrink-0 items-center justify-between border-b border-outline bg-background px-5 py-3">
        <div className="flex items-center gap-2">
          <svg className="h-5 w-5 text-primary" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z" />
          </svg>
          <h1 className="text-base font-semibold tracking-tight text-on-background">Distill</h1>
        </div>
        <ToggleSwitch checked={true} size="md" />
      </header>

      <main className="flex flex-1 flex-col gap-5 overflow-y-auto bg-background p-4">
        <div className="flex items-center justify-between">
          <div
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 ${
              simplified
                ? 'border-[#064e3b] bg-status-bg'
                : 'border-outline bg-surface'
            }`}
          >
            <div className={`h-1.5 w-1.5 rounded-full ${simplified ? 'bg-status-text' : 'bg-on-surface-variant'}`} />
            <span className={`text-xs font-medium ${simplified ? 'text-status-text' : 'text-on-surface-variant'}`}>
              {simplified ? 'Local processing active' : 'Local processing idle'}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={simplified ? restorePage : simplifyPage}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-primary-hover"
          >
            <Icon name={simplified ? 'visibility' : 'layers'} className="text-[18px]" />
            {simplified ? 'Show Original Page' : 'Simplify Current Page'}
          </button>
          <button
            type="button"
            className="flex w-full items-center justify-center gap-2 rounded-md border border-outline bg-surface px-4 py-2 text-sm font-medium text-on-surface transition-colors hover:bg-surface-hover"
          >
            <Icon name="tune" className="text-[16px]" />
            View Settings
          </button>
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="rounded-md border border-card-border bg-card-bg p-3">
          <div className="mb-1 flex items-center gap-2">
            <Icon name="person" className="text-[16px] text-on-surface-variant" />
            <h3 className="text-sm font-medium text-on-surface">Default Profile</h3>
          </div>
          <p className="text-xs text-on-surface-variant">Spacing: +40% • Text: 1.15x • High Contrast</p>
        </div>

        <div>
          <h2 className="section-header mb-2 text-xs font-semibold tracking-wide text-on-surface-variant uppercase">
            Simplification Controls
          </h2>
          <div className="overflow-hidden rounded-md border border-card-border bg-card-bg">
            <div className="border-b border-card-border p-4">
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium text-on-surface">Intensity</label>
                <span className="text-xs text-on-surface-variant">50%</span>
              </div>
              <input type="range" min={1} max={100} defaultValue={50} />
            </div>

            <div className="flex flex-col">
              <label className="flex cursor-pointer items-center justify-between border-b border-card-border p-3 transition-colors hover:bg-surface-hover">
                <div className="flex items-center gap-2.5">
                  <Icon name="animation" className="text-[18px] text-on-surface-variant" />
                  <span className="text-sm text-on-surface">Reduce motion</span>
                </div>
                <ToggleSwitch checked={true} />
              </label>
              <label className="flex cursor-pointer items-center justify-between border-b border-card-border p-3 transition-colors hover:bg-surface-hover">
                <div className="flex items-center gap-2.5">
                  <Icon name="format_line_spacing" className="text-[18px] text-on-surface-variant" />
                  <span className="text-sm text-on-surface">Increase spacing</span>
                </div>
                <ToggleSwitch checked={true} />
              </label>
              <label className="flex cursor-pointer items-center justify-between border-b border-card-border p-3 transition-colors hover:bg-surface-hover">
                <div className="flex items-center gap-2.5">
                  <Icon name="visibility" className="text-[18px] text-on-surface-variant" />
                  <span className="text-sm text-on-surface">Progressive reveal</span>
                </div>
                <ToggleSwitch
                  checked={progressiveRevealActive}
                  disabled={!progressiveRevealAvailable}
                  onChange={toggleProgressiveReveal}
                />
              </label>
              <label className="flex cursor-pointer items-center justify-between p-3 transition-colors hover:bg-surface-hover">
                <div className="flex items-center gap-2.5">
                  <Icon name="palette" className="text-[18px] text-on-surface-variant" />
                  <span className="text-sm text-on-surface">Reduce color variation</span>
                </div>
                <ToggleSwitch
                  checked={colorReductionActive}
                  disabled={!colorReductionAvailable}
                  onChange={toggleColorReduction}
                />
              </label>
            </div>
          </div>
        </div>

        <div className="pt-2 pb-6">
          <button
            type="button"
            className="flex w-full items-center justify-center gap-2 rounded-md bg-transparent px-4 py-2 text-sm text-on-surface-variant transition-colors hover:text-on-surface"
          >
            <Icon name="visibility_off" className="text-[16px]" />
            Show everything temporarily
          </button>
        </div>
      </main>

      <footer className="flex w-full shrink-0 flex-col items-center gap-2 border-t border-outline bg-background px-4 py-3 text-xs text-on-surface-variant">
        <div className="flex gap-3">
          <a className="transition-colors hover:text-on-surface" href="#">
            Privacy
          </a>
          <span>·</span>
          <a className="transition-colors hover:text-on-surface" href="#">
            Feedback
          </a>
        </div>
        <p>Distill v{EXTENSION_VERSION}</p>
      </footer>
    </div>
  )
}

export default App
