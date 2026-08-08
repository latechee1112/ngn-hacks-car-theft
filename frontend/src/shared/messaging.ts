// Names shared between the content script and the service worker. They live in one
// place because the two are built as separate bundles that never import each other at
// runtime: a typo in a duplicated port name wouldn't fail the build, it would just mean
// the connect handler never matches and every analysis silently falls back to the local
// heuristic.

export const ANALYZE_PORT = 'distill-analyze'
