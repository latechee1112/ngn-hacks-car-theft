import { extractPage } from './extract'

console.log('[FocusFit] content script injected on', window.location.href)

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'FOCUSFIT_PING') {
    sendResponse({ ok: true, title: document.title, url: window.location.href })
    return true
  }
  if (message?.type === 'FOCUSFIT_EXTRACT') {
    sendResponse(extractPage())
    return true
  }
  return true
})
