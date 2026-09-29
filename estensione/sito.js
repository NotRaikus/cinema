// Runs inside the Cinema per due page: a bridge between the page and the extension.
if (location.pathname.includes('cinema')) {
  const toPage = msg => window.postMessage({ source: 'cinema-ext', ...msg }, location.origin);

  chrome.runtime.onMessage.addListener(msg => { if (msg.type === 'sub') toPage(msg); });

  window.addEventListener('message', e => {
    if (e.source !== window || e.data?.source !== 'cinema-page') return;
    const { type } = e.data;
    if (type === 'ping') toPage({ type: 'hello' });
    if (type === 'control') chrome.runtime.sendMessage({ type, action: e.data.action });
    if (type === 'langs') chrome.runtime.sendMessage({ type, langs: e.data.langs });
  });

  toPage({ type: 'hello' });
}
