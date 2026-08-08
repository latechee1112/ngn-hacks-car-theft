import { useEffect, useState } from 'react'
import ToggleSwitch from './ToggleSwitch'
import Icon from './Icon'

async function getActiveTabId(): Promise<number | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab?.id ?? null
}

const EXTENSION_VERSION = chrome.runtime.getManifest().version

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-on-surface-variant focus-visible:ring-offset-2 focus-visible:ring-offset-background'

function App() {
  const [simplified, setSimplified] = useState(false)
  const [colorReductionAvailable, setColorReductionAvailable] = useState(false)
  const [colorReductionActive, setColorReductionActive] = useState(false)
  const [progressiveRevealAvailable, setProgressiveRevealAvailable] = useState(false)
  const [progressiveRevealActive, setProgressiveRevealActive] = useState(false)
  const [error, setError] = useState<string>('')
  const [analyzing, setAnalyzing] = useState(false)

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
    setAnalyzing(true)
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
    } finally {
      setAnalyzing(false)
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
      <header className="flex w-full shrink-0 items-center justify-between border-b border-outline bg-background px-4 py-3">
        <div className="flex items-center gap-2">
          <Icon name="funnel" className="text-on-background" />
          <h1 className="text-title font-semibold tracking-tight text-on-background">Distill</h1>
        </div>
        <ToggleSwitch checked={true} size="md" />
      </header>

      <main className="flex flex-1 flex-col gap-6 overflow-y-auto bg-background p-4">
        <div className="flex items-center justify-between">
          <div className="inline-flex items-center gap-2 rounded-full border border-outline bg-surface px-3 py-1">
            <div className={`h-1.5 w-1.5 rounded-full ${simplified ? 'bg-accent-text' : 'bg-on-surface-muted'}`} />
            <span className={`text-meta font-medium ${simplified ? 'text-accent-text' : 'text-on-surface-variant'}`}>
              {simplified ? 'Local processing active' : 'Local processing idle'}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={simplified ? restorePage : simplifyPage}
            disabled={analyzing}
            aria-busy={analyzing}
            className={`flex w-full items-center justify-center gap-2 rounded-md px-4 py-2 text-body font-medium transition-colors ${FOCUS_RING} ${
              analyzing
                ? 'cursor-wait border border-outline bg-surface text-on-surface-variant'
                : 'bg-accent text-accent-fg hover:bg-accent-hover'
            }`}
          >
            {analyzing ? (
              <>
                <Icon name="spinner" className="animate-spin text-accent-text" />
                Simplifying…
              </>
            ) : (
              <>
                <Icon name={simplified ? 'restore' : 'layers'} />
                {simplified ? 'Show Original Page' : 'Simplify Current Page'}
              </>
            )}
          </button>
          <button
            type="button"
            className={`flex w-full items-center justify-center gap-2 rounded-md border border-outline bg-surface px-4 py-2 text-body font-medium text-on-surface transition-colors hover:bg-surface-hover ${FOCUS_RING}`}
          >
            <Icon name="sliders" />
            View Settings
          </button>
        </div>

        {error && <p className="text-meta text-danger-text">{error}</p>}

        <div className="rounded-md border border-outline bg-surface p-4">
          <div className="mb-2 flex items-center gap-2">
            <Icon name="user" className="text-on-surface-variant" />
            <h3 className="text-body font-medium text-on-surface">Default Profile</h3>
          </div>
          <p className="text-meta text-on-surface-variant">Spacing: +40% · Text: 1.15x · High Contrast</p>
        </div>

        <div>
          <h2 className="mb-2 text-meta font-semibold tracking-[0.08em] text-on-surface-variant uppercase">
            Simplification Controls
          </h2>
          <div className="overflow-hidden rounded-md border border-outline bg-surface">
            <div className="border-b border-outline p-4">
              <div className="mb-3 flex items-center justify-between">
                <label className="text-body font-medium text-on-surface">Intensity</label>
                <span className="text-meta tabular-nums text-on-surface-variant">50%</span>
              </div>
              <input type="range" min={1} max={100} defaultValue={50} />
            </div>

            <div className="flex flex-col">
              <label
                className="flex cursor-pointer items-center justify-between border-b border-outline px-4 py-3 transition-colors hover:bg-surface-hover focus-within:ring-2 focus-within:ring-on-surface-variant focus-within:ring-inset"
              >
                <div className="flex items-center gap-3">
                  <Icon name="pulse" className="text-on-surface-variant" />
                  <span className="text-body text-on-surface">Reduce motion</span>
                </div>
                <ToggleSwitch checked={true} />
              </label>
              <label
                className="flex cursor-pointer items-center justify-between border-b border-outline px-4 py-3 transition-colors hover:bg-surface-hover focus-within:ring-2 focus-within:ring-on-surface-variant focus-within:ring-inset"
              >
                <div className="flex items-center gap-3">
                  <Icon name="spacing" className="text-on-surface-variant" />
                  <span className="text-body text-on-surface">Increase spacing</span>
                </div>
                <ToggleSwitch checked={true} />
              </label>
              <label
                className="flex cursor-pointer items-center justify-between border-b border-outline px-4 py-3 transition-colors hover:bg-surface-hover focus-within:ring-2 focus-within:ring-on-surface-variant focus-within:ring-inset"
              >
                <div className="flex items-center gap-3">
                  <Icon name="eye" className="text-on-surface-variant" />
                  <span className="text-body text-on-surface">Progressive reveal</span>
                </div>
                <ToggleSwitch
                  checked={progressiveRevealActive}
                  disabled={!progressiveRevealAvailable}
                  onChange={toggleProgressiveReveal}
                />
              </label>
              <label
                className="flex cursor-pointer items-center justify-between px-4 py-3 transition-colors hover:bg-surface-hover focus-within:ring-2 focus-within:ring-on-surface-variant focus-within:ring-inset"
              >
                <div className="flex items-center gap-3">
                  <Icon name="droplet" className="text-on-surface-variant" />
                  <span className="text-body text-on-surface">Reduce color variation</span>
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

        <div className="pb-2">
          <button
            type="button"
            className={`flex w-full items-center justify-center gap-2 rounded-md px-4 py-2 text-body text-on-surface-variant transition-colors hover:bg-surface hover:text-on-surface ${FOCUS_RING}`}
          >
            <Icon name="expand" />
            Show everything temporarily
          </button>
        </div>
      </main>

      <footer className="flex w-full shrink-0 flex-col items-center gap-2 border-t border-outline bg-background px-4 py-4 text-meta text-on-surface-variant">
        <div className="flex items-center gap-3">
          <a className={`rounded-sm transition-colors hover:text-on-background ${FOCUS_RING}`} href="#">
            Privacy
          </a>
          <span className="text-on-surface-muted">·</span>
          <a className={`rounded-sm transition-colors hover:text-on-background ${FOCUS_RING}`} href="#">
            Feedback
          </a>
        </div>
        <p className="text-on-surface-muted">Distill v{EXTENSION_VERSION}</p>
      </footer>
    </div>
  )
}

export default App
