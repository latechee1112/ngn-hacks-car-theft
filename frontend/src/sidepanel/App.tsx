import { useEffect, useState } from 'react'
import {
  Eye,
  EyeOff,
  Palette,
  Rows3,
  ScanEye,
  SlidersHorizontal,
  Sparkles,
  User,
  Waves,
} from 'lucide-react'
import ToggleSwitch from './ToggleSwitch'

async function getActiveTabId(): Promise<number | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab?.id ?? null
}

const EXTENSION_VERSION = chrome.runtime.getManifest().version

function App() {
  const [simplified, setSimplified] = useState(false)
  const [colorReductionAvailable, setColorReductionAvailable] = useState(false)
  const [colorReductionActive, setColorReductionActive] = useState(false)
  const [error, setError] = useState<string>('')

  async function refreshStatus() {
    try {
      const tabId = await getActiveTabId()
      if (!tabId) return
      const response = (await chrome.tabs.sendMessage(tabId, { type: 'DISTILL_STATUS' })) as {
        simplified: boolean
        colorReductionAvailable: boolean
        colorReductionActive: boolean
      }
      setSimplified(response.simplified)
      setColorReductionAvailable(response.colorReductionAvailable)
      setColorReductionActive(response.colorReductionActive)
    } catch {
      setSimplified(false)
      setColorReductionAvailable(false)
      setColorReductionActive(false)
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
    } catch (err) {
      setError(`Couldn't simplify this page: ${String(err)}`)
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

  return (
    <div className="flex min-h-screen flex-col gap-4 bg-[#0b0e1a] p-4 text-white">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-500/20 text-indigo-400">
            <ScanEye size={14} />
          </span>
          <span className="font-semibold">Distill</span>
        </div>
        <ToggleSwitch checked={true} />
      </header>

      <div
        className={`inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
          simplified
            ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
            : 'border-slate-700 bg-slate-800/60 text-slate-400'
        }`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${simplified ? 'bg-emerald-400' : 'bg-slate-500'}`} />
        {simplified ? 'Local processing active' : 'Local processing idle'}
      </div>

      <button
        type="button"
        onClick={simplifyPage}
        className="flex items-center justify-center gap-2 rounded-xl bg-indigo-500 py-2.5 font-medium text-white shadow-lg shadow-indigo-500/20 transition-colors hover:bg-indigo-400"
      >
        <Sparkles size={16} />
        Simplify Current Page
      </button>

      <button
        type="button"
        className="flex items-center justify-center gap-2 rounded-xl border border-slate-700/50 bg-slate-800/60 py-2.5 font-medium text-slate-200 transition-colors hover:bg-slate-800"
      >
        <SlidersHorizontal size={16} />
        View Settings
      </button>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex items-start gap-2 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-800 text-slate-300">
          <User size={13} />
        </span>
        <div>
          <p className="text-sm font-medium">Default Profile</p>
          <p className="mt-0.5 text-xs text-slate-400">Spacing: +40% • Text: 1.15x • High Contrast</p>
        </div>
      </div>

      <p className="mt-1 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
        Simplification controls
      </p>

      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Intensity</span>
          <span className="text-xs text-slate-400">50%</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
          <div className="h-full w-1/2 rounded-full bg-indigo-400" />
        </div>
      </div>

      <div className="flex flex-col divide-y divide-slate-800/60 rounded-xl border border-slate-800 bg-slate-900/60 px-3">
        <div className="flex items-center justify-between py-2.5">
          <span className="flex items-center gap-2 text-sm font-medium text-amber-400">
            <Waves size={15} />
            Reduce motion
          </span>
          <ToggleSwitch checked={true} />
        </div>
        <div className="flex items-center justify-between py-2.5">
          <span className="flex items-center gap-2 text-sm font-medium text-amber-400">
            <Rows3 size={15} />
            Increase spacing
          </span>
          <ToggleSwitch checked={true} />
        </div>
        <div className="flex items-center justify-between py-2.5">
          <span className="flex items-center gap-2 text-sm font-medium text-amber-400">
            <Eye size={15} />
            Progressive reveal
          </span>
          <ToggleSwitch checked={true} />
        </div>
        <div className="flex items-center justify-between py-2.5">
          <span
            className={`flex items-center gap-2 text-sm font-medium ${
              colorReductionAvailable ? 'text-amber-400' : 'text-amber-400/40'
            }`}
          >
            <Palette size={15} />
            Reduce color variation
          </span>
          <ToggleSwitch
            checked={colorReductionActive}
            disabled={!colorReductionAvailable}
            onChange={toggleColorReduction}
          />
        </div>
      </div>

      <button
        type="button"
        className="mx-auto flex items-center gap-1.5 text-xs text-slate-400 transition-colors hover:text-slate-300"
      >
        <EyeOff size={13} />
        Show everything temporarily
      </button>

      <footer className="mt-auto flex flex-col items-center gap-1 border-t border-slate-800 pt-3">
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <button type="button" className="hover:text-slate-300">
            Privacy
          </button>
          <span>·</span>
          <button type="button" className="hover:text-slate-300">
            Feedback
          </button>
        </div>
        <p className="text-[11px] text-slate-600">Distill v{EXTENSION_VERSION}</p>
      </footer>
    </div>
  )
}

export default App
