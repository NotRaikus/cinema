// Runs inside the Cinema per due page: a bridge between the page and the extension.
if (location.pathname.includes('cinema')) {
  const toPage = msg => window.postMessage({ source: 'cinema-ext', ...msg }, location.origin);

  chrome.runtime.onMessage.addListener(msg => { if (msg.type === 'sub') toPage(msg); });

  window.addEventListener('message', e => {
    if (e.source !== window || e.data?.source !== 'cinema-page') return;
    if (e.data.type === 'ping') toPage({ type: 'hello' });
    if (e.data.type === 'control') chrome.runtime.sendMessage({ type: 'control', action: e.data.action });
  });

  toPage({ type: 'hello' });
}
