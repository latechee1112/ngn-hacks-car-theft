chrome.runtime.onInstalled.addListener(() => {
  console.log('[FocusFit] service worker installed')
})

// Open the side panel when the user clicks the toolbar icon (instead of a popup).
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error)
