import { useEffect, useState } from 'react'
import ToggleSwitch from './ToggleSwitch'
import Icon from './Icon'
import type { ExtractionResult } from '../types/page'

async function getActiveTabId(): Promise<number | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab?.id ?? null
}

// Tabs that were already open when the extension was installed or reloaded
// never got the manifest's content script, so messaging them fails with
// "Receiving end does not exist". Inject it once, on demand, and retry — the
// injection only happens after a failed ping, so a tab that already has the
// script never gets a second copy (and a second message listener).
async function sendToTab<T>(tabId: number, message: unknown): Promise<T> {
  try {
    return (await chrome.tabs.sendMessage(tabId, message)) as T
  } catch (err) {
    if (!String(err).includes('Receiving end does not exist')) throw err
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] })
    return (await chrome.tabs.sendMessage(tabId, message)) as T
  }
}

const EXTENSION_VERSION = chrome.runtime.getManifest().version

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-on-surface-variant focus-visible:ring-offset-2 focus-visible:ring-offset-background'

// The panel unmounts every time it closes, so the Simplification Controls have
// to persist somewhere. chrome.storage.local (the "storage" permission is
// already in the manifest) keeps them across opens and across browser restarts.
const SETTINGS_KEY = 'distillSettings'

interface StoredSettings {
  intensity: number // 1-100, as shown on the slider
  reduceMotion: boolean
  increaseSpacing: boolean
}

const DEFAULT_SETTINGS: StoredSettings = {
  // 75% - deemphasized content should read as strongly blurred/censored the
  // first time a page is simplified, before the user touches the slider.
  intensity: 75,
  reduceMotion: true,
  increaseSpacing: true,
}

async function loadSettings(): Promise<StoredSettings> {
  try {
    const stored = await chrome.storage.local.get(SETTINGS_KEY)
    return { ...DEFAULT_SETTINGS, ...(stored?.[SETTINGS_KEY] ?? {}) }
  } catch {
    return DEFAULT_SETTINGS
  }
}

function App() {
  const [simplified, setSimplified] = useState(false)
  const [colorReductionAvailable, setColorReductionAvailable] = useState(false)
  const [colorReductionActive, setColorReductionActive] = useState(false)
  const [progressiveRevealAvailable, setProgressiveRevealAvailable] = useState(false)
  const [progressiveRevealActive, setProgressiveRevealActive] = useState(false)
  const [error, setError] = useState<string>('')
  const [analyzing, setAnalyzing] = useState(false)

  // Debug-only: the last raw extraction, pretty-printed. null means "never
  // dumped in this panel session" — the output panel stays hidden until then.
  const [rawBlocks, setRawBlocks] = useState<string | null>(null)
  const [rawBlockCount, setRawBlockCount] = useState(0)
  const [dumping, setDumping] = useState(false)
  const [copied, setCopied] = useState(false)

  const [intensity, setIntensity] = useState(DEFAULT_SETTINGS.intensity)
  const [reduceMotion, setReduceMotion] = useState(DEFAULT_SETTINGS.reduceMotion)
  const [increaseSpacing, setIncreaseSpacing] = useState(DEFAULT_SETTINGS.increaseSpacing)
  // Guards the persist effect below: without it the first render would write
  // the defaults over whatever was stored before load() resolves.
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  // Intensity feeds the backend's classification, so it can only take effect on
  // the next run. Tracking what was actually sent lets us say so honestly.
  const [appliedIntensity, setAppliedIntensity] = useState<number | null>(null)

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
        reduceMotionActive: boolean
        spacingIncreased: boolean
      }
      setSimplified(response.simplified)
      setColorReductionAvailable(response.colorReductionAvailable)
      setColorReductionActive(response.colorReductionActive)
      setProgressiveRevealAvailable(response.progressiveRevealAvailable)
      setProgressiveRevealActive(response.progressiveRevealActive)
      // Only trust the page for these two while it is actually simplified —
      // an unsimplified page has both cleared, which says nothing about what
      // the user prefers next time.
      if (response.simplified) {
        setReduceMotion(response.reduceMotionActive)
        setIncreaseSpacing(response.spacingIncreased)
      }
    } catch {
      setSimplified(false)
      setColorReductionAvailable(false)
      setColorReductionActive(false)
      setProgressiveRevealAvailable(false)
      setProgressiveRevealActive(false)
    }
  }

  useEffect(() => {
    // Sequential on purpose: stored preferences load first, then refreshStatus
    // may override the two live toggles from the actual page state.
    async function init() {
      const stored = await loadSettings()
      setIntensity(stored.intensity)
      setReduceMotion(stored.reduceMotion)
      setIncreaseSpacing(stored.increaseSpacing)
      await refreshStatus()
      setSettingsLoaded(true)
    }
    init()
  }, [])

  useEffect(() => {
    if (!settingsLoaded) return
    chrome.storage.local
      .set({ [SETTINGS_KEY]: { intensity, reduceMotion, increaseSpacing } })
      .catch(() => {})
  }, [settingsLoaded, intensity, reduceMotion, increaseSpacing])

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
        settings: {
          // Slider is 1-100; the backend's VisualProfile wants 0.0-1.0.
          simplificationStrength: intensity / 100,
          reduceMotion,
          increaseSpacing,
        },
      })) as { primaryFound: boolean; deemphasizedCount: number }
      setSimplified(true)
      setColorReductionAvailable(response.primaryFound)
      setProgressiveRevealAvailable(response.primaryFound)
      setAppliedIntensity(intensity)
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
      setAppliedIntensity(null)
    } catch (err) {
      setError(`Couldn't restore this page: ${String(err)}`)
    }
  }

  // Debug affordance: re-runs the same extraction that gets sent to the backend
  // and shows it verbatim, so a bad simplification can be traced to what the
  // page actually looked like at extraction time. Read-only — DISTILL_EXTRACT
  // touches nothing but the data-distill-id attributes extract() already sets.
  async function dumpRawBlocks() {
    setError('')
    setCopied(false)
    setDumping(true)
    try {
      const tabId = await getActiveTabId()
      if (!tabId) {
        setError('No active tab found')
        return
      }
      const response = await sendToTab<ExtractionResult>(tabId, { type: 'DISTILL_EXTRACT' })
      setRawBlockCount(response.blocks.length)
      setRawBlocks(JSON.stringify(response.blocks, null, 2))
    } catch (err) {
      setRawBlocks(null)
      setRawBlockCount(0)
      // Chrome refuses injection on its own pages and the Web Store, so this
      // is a page Distill can never read — not a bug worth a raw stack trace.
      const message = /cannot be scripted|chrome:\/\/|extension:\/\//i.test(String(err))
        ? "This page can't be read by extensions (chrome:// pages, the Web Store, and PDF viewer are off limits)."
        : String(err)
      setError(`Couldn't extract blocks from this page: ${message}`)
    } finally {
      setDumping(false)
    }
  }

  async function copyRawBlocks() {
    if (!rawBlocks) return
    try {
      await navigator.clipboard.writeText(rawBlocks)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch (err) {
      setError(`Couldn't copy to clipboard: ${String(err)}`)
    }
  }

  // Reduce motion and Increase spacing are CSS switches, so they apply to an
  // already-simplified page immediately. When nothing is simplified yet the
  // content script reports applied:false and we just keep the preference —
  // it ships with the next Activate.
  async function pushLayoutPreference(
    type: 'DISTILL_SET_REDUCE_MOTION' | 'DISTILL_SET_SPACING',
    enabled: boolean,
  ) {
    setError('')
    try {
      const tabId = await getActiveTabId()
      if (!tabId) return
      await chrome.tabs.sendMessage(tabId, { type, enabled })
    } catch {
      // No content script on this tab (chrome:// page, PDF viewer, etc.).
      // The preference is still stored and still applies on the next page.
    }
  }

  function toggleReduceMotion(enabled: boolean) {
    setReduceMotion(enabled)
    pushLayoutPreference('DISTILL_SET_REDUCE_MOTION', enabled)
  }

  function toggleIncreaseSpacing(enabled: boolean) {
    setIncreaseSpacing(enabled)
    pushLayoutPreference('DISTILL_SET_SPACING', enabled)
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
    <div className="relative flex max-h-[600px] w-full flex-col overflow-hidden bg-background">
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
                <label htmlFor="distill-intensity" className="text-body font-medium text-on-surface">
                  Intensity
                </label>
                <span className="text-meta tabular-nums text-on-surface-variant">{intensity}%</span>
              </div>
              <input
                id="distill-intensity"
                type="range"
                min={1}
                max={100}
                value={intensity}
                onChange={(e) => setIntensity(Number(e.target.value))}
              />
              {/* Intensity is an input to the backend's classification, not a
                  CSS switch — it cannot retroactively change an analysis that
                  already ran, so say so rather than looking broken. */}
              {simplified && appliedIntensity !== null && appliedIntensity !== intensity && (
                <p className="mt-3 text-meta text-on-surface-variant">
                  Applies on next simplify (currently {appliedIntensity}%).
                </p>
              )}
            </div>

            <div className="flex flex-col">
              <label
                className="flex cursor-pointer items-center justify-between border-b border-outline px-4 py-3 transition-colors hover:bg-surface-hover focus-within:ring-2 focus-within:ring-on-surface-variant focus-within:ring-inset"
              >
                <div className="flex items-center gap-3">
                  <Icon name="pulse" className="text-on-surface-variant" />
                  <span className="text-body text-on-surface">Reduce motion</span>
                </div>
                <ToggleSwitch checked={reduceMotion} onChange={toggleReduceMotion} />
              </label>
              <label
                className="flex cursor-pointer items-center justify-between border-b border-outline px-4 py-3 transition-colors hover:bg-surface-hover focus-within:ring-2 focus-within:ring-on-surface-variant focus-within:ring-inset"
              >
                <div className="flex items-center gap-3">
                  <Icon name="spacing" className="text-on-surface-variant" />
                  <span className="text-body text-on-surface">Increase spacing</span>
                </div>
                <ToggleSwitch checked={increaseSpacing} onChange={toggleIncreaseSpacing} />
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

        <div>
          <button
            type="button"
            className={`flex w-full items-center justify-center gap-2 rounded-md px-4 py-2 text-body text-on-surface-variant transition-colors hover:bg-surface hover:text-on-surface ${FOCUS_RING}`}
          >
            <Icon name="expand" />
            Show everything temporarily
          </button>
        </div>

        {/* Debug tools. Bright green on purpose — this is developer output, not
            a user-facing control, and it should never blend into the panel. */}
        <div className="flex flex-col gap-2 pb-2">
          <h2 className="text-meta font-semibold tracking-[0.08em] text-on-surface-variant uppercase">Debug</h2>
          <button
            type="button"
            onClick={dumpRawBlocks}
            disabled={dumping}
            aria-busy={dumping}
            className={`flex w-full items-center justify-center gap-2 rounded-md px-4 py-2 text-body font-medium transition-colors ${FOCUS_RING} ${
              dumping
                ? 'cursor-wait border border-outline bg-surface text-on-surface-variant'
                : 'bg-debug text-debug-fg hover:bg-debug-hover'
            }`}
          >
            {dumping ? (
              <>
                <Icon name="spinner" className="animate-spin text-debug-text" />
                Extracting…
              </>
            ) : (
              <>
                <Icon name="bug" />
                Dump Raw Blocks JSON
              </>
            )}
          </button>

          {rawBlocks !== null && (
            <details className="overflow-hidden rounded-md border border-debug/40 bg-surface" open>
              <summary
                className={`cursor-pointer list-none px-3 py-2 text-meta font-semibold text-debug-text select-none marker:content-none hover:bg-surface-hover ${FOCUS_RING}`}
              >
                Raw blocks JSON · {rawBlockCount} block{rawBlockCount === 1 ? '' : 's'}
              </summary>
              <div className="border-t border-outline">
                <pre className="max-h-64 overflow-auto p-3 font-mono text-meta leading-[15px] whitespace-pre text-on-surface">
                  {rawBlocks}
                </pre>
                <div className="flex justify-end border-t border-outline p-2">
                  <button
                    type="button"
                    onClick={copyRawBlocks}
                    className={`flex items-center gap-1.5 rounded-md border border-outline bg-surface px-3 py-1 text-meta text-on-surface transition-colors hover:bg-surface-hover ${FOCUS_RING}`}
                  >
                    <Icon name={copied ? 'check' : 'copy'} className={copied ? 'text-debug-text' : ''} />
                    {copied ? 'Copied' : 'Copy JSON'}
                  </button>
                </div>
              </div>
            </details>
          )}
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
