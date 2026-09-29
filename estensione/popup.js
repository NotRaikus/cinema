const DEFAULTS = { engine: 'google', apiKey: '', model: 'claude-opus-5-5', hideOriginal: true };
const $ = id => document.getElementById(id);

chrome.storage.local.get(DEFAULTS, s => {
  $('engine').value = s.engine;
  $('apiKey').value = s.apiKey;
  $('model').value = s.model;
  $('hideOriginal').checked = s.hideOriginal;
  $('claudeBox').hidden = s.engine !== 'claude';
});

$('engine').onchange = e => { chrome.storage.local.set({ engine: e.target.value }); $('claudeBox').hidden = e.target.value !== 'claude'; };
$('apiKey').onchange = e => chrome.storage.local.set({ apiKey: e.target.value.trim() });
$('model').onchange = e => chrome.storage.local.set({ model: e.target.value.trim() || DEFAULTS.model });
$('hideOriginal').onchange = e => chrome.storage.local.set({ hideOriginal: e.target.checked });

function showLast() {
  chrome.storage.session.get({ lastLine: '' }, s => { $('last').textContent = s.lastLine || '—'; });
}
showLast();
setInterval(showLast, 500);
