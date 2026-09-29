// Runs on the streaming site. Every 120 ms it reads the subtitle line the player is
// showing (the official one, already in sync with the film) and reports changes.
// Tip: turn on subtitles in the player (English or the film's language works best);
// the extension can hide them on screen so they are not seen twice.

const SELECTORS = {
  'netflix.com': ['.player-timedtext-text-container'],
  'disneyplus.com': ['.dss-subtitle-renderer-line', '.hive-subtitle-renderer-line', '[class*="subtitle-renderer"] [class*="line"]'],
  'max.com': ['[data-testid="CueBoxContainer"]', '[class*="CaptionWindow"]', '[class*="TextCue"]'],
  'hbomax.com': ['[data-testid="CueBoxContainer"]', '[class*="CaptionWindow"]', '[class*="TextCue"]'],
  'primevideo.com': ['.atvwebplayersdk-captions-text'],
  'amazon.': ['.atvwebplayersdk-captions-text'],
  'youtube.com': ['.caption-visual-line'],
};
const site = Object.keys(SELECTORS).find(k => location.hostname.includes(k));
const selectors = SELECTORS[site] || [];

// Some players (Disney+) draw inside shadow DOM: look through open shadow roots too.
let shadowHosts = [];
let hostsScanned = 0;
function roots() {
  if (Date.now() - hostsScanned > 2000) {
    hostsScanned = Date.now();
    shadowHosts = [...document.querySelectorAll('*')].filter(el => el.shadowRoot);
  }
  return [document, ...shadowHosts.map(h => h.shadowRoot)];
}

function currentLine() {
  for (const sel of selectors) {
    const parts = [];
    for (const root of roots()) {
      for (const el of root.querySelectorAll(sel)) {
        const text = (el.innerText || el.textContent || '').trim();
        if (text) parts.push(text);
      }
    }
    if (parts.length) return parts.join('\n').replace(/[ \t]+/g, ' ');
  }
  return '';
}

let last = '';
let seq = 0;
setInterval(() => {
  if (!chrome.runtime?.id) return; // extension reloaded: this old copy is orphaned
  const line = currentLine();
  if (line === last) return;
  last = line;
  chrome.runtime.sendMessage({ type: 'line', text: line, seq: ++seq, site }).catch(() => {});
}, 120);

// Hide the site's own subtitles (they stay in the page, so they can still be read).
const hide = document.createElement('style');
hide.textContent = `${selectors.join(',')} { opacity: 0 !important; }
  .player-timedtext, .ytp-caption-window-container, .atvwebplayersdk-captions-overlay { opacity: 0 !important; }`;
function applyHide(on) { if (on) document.documentElement.append(hide); else hide.remove(); }
chrome.storage.local.get({ hideOriginal: true }, s => applyHide(s.hideOriginal));
chrome.storage.onChanged.addListener(c => { if (c.hideOriginal) applyHide(c.hideOriginal.newValue); });

// Play / pause asked from the room (either of the two).
function mainVideo() {
  const videos = roots().flatMap(r => [...r.querySelectorAll('video')]);
  return videos.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
}
chrome.runtime.onMessage.addListener(msg => {
  if (msg.type !== 'control') return;
  const v = mainVideo();
  if (!v) return;
  if (v.paused) v.play(); else v.pause();
});
