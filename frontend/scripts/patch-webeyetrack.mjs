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
import { createRequire } from 'node:module'

// Resolve via real Node module resolution rather than a path relative to
// this script - npm can hoist webeyetrack up to a parent node_modules
// (e.g. the repo root) instead of frontend/node_modules, and a hardcoded
// path would silently miss it, leaving the unpatched CDN-loading bundle in
// whatever copy actually gets used.
const require = createRequire(import.meta.url)

let bundlePath
try {
  bundlePath = require.resolve('webeyetrack/dist/index.js')
} catch {
  // webeyetrack isn't installed (e.g. a partial/offline install) - nothing to patch.
  process.exit(0)
}

const REPLACEMENTS = [
  ['"https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"', '"/mediapipe/wasm"'],
  [
    '"https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"',
    '"/mediapipe/face_landmarker.task"',
  ],
]

let bundle = readFileSync(bundlePath, 'utf-8')

let changed = false
for (const [from, to] of REPLACEMENTS) {
  // The bundle references each URL from more than one call site, so a
  // single non-global replace used to leave one occurrence unpatched while
  // still looking "done" (the target string was present from the other
  // site) - split/join replaces every occurrence instead.
  if (bundle.includes(from)) {
    bundle = bundle.split(from).join(to)
    changed = true
    continue
  }
  if (!bundle.includes(to)) {
    console.warn(
      `[patch-webeyetrack] Expected string not found (package version changed?): ${from}. ` +
        'Camera-based calibration may try to reach the network - re-check this patch against the installed version.',
    )
  }
}

if (changed) {
  writeFileSync(bundlePath, bundle, 'utf-8')
  console.log('[patch-webeyetrack] Patched dist/index.js to use self-hosted MediaPipe assets.')
} else {
  console.log('[patch-webeyetrack] Already patched, nothing to do.')
}
