// webeyetrack@0.0.2's compiled bundle hardcodes two remote asset URLs with no
// exposed config to override them (backend/services/profile_rules.py's
// counterpart doesn't need this - this is purely a frontend packaging fix):
//   - MediaPipe's WASM glue, loaded via a <script src="..."> tag injection
//     (not fetch()), so it can't be intercepted at runtime - only a source
//     patch or a full vendor/fork of the package can redirect it.
//   - The face_landmarker .task model file.
// Both are blocked by an MV3 extension page's default script-src 'self' CSP
// anyway, and fetching them live would break the calibration page's own
// privacy claim ("nothing is ever sent anywhere"). This patches the
// installed package to point at the self-hosted copies in public/mediapipe/
// instead (see scripts/README or the calibration plan for how those were
// obtained). Runs automatically via package.json's "postinstall" so it
// survives a fresh `npm install`; idempotent, so re-running is harmless.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const bundlePath = join(__dirname, '..', 'node_modules', 'webeyetrack', 'dist', 'index.js')

const REPLACEMENTS = [
  ['"https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"', '"/mediapipe/wasm"'],
  [
    '"https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"',
    '"/mediapipe/face_landmarker.task"',
  ],
]

let bundle
try {
  bundle = readFileSync(bundlePath, 'utf-8')
} catch {
  // webeyetrack isn't installed (e.g. a partial/offline install) - nothing to patch.
  process.exit(0)
}

let changed = false
for (const [from, to] of REPLACEMENTS) {
  if (bundle.includes(to)) continue // already patched
  if (!bundle.includes(from)) {
    console.warn(
      `[patch-webeyetrack] Expected string not found (package version changed?): ${from}. ` +
        'Camera-based calibration may try to reach the network - re-check this patch against the installed version.',
    )
    continue
  }
  bundle = bundle.replace(from, to)
  changed = true
}

if (changed) {
  writeFileSync(bundlePath, bundle, 'utf-8')
  console.log('[patch-webeyetrack] Patched dist/index.js to use self-hosted MediaPipe assets.')
} else {
  console.log('[patch-webeyetrack] Already patched, nothing to do.')
}
