const DEFAULTS = { engine: 'google', apiKey: '', model: 'claude-opus-5-5', hideOriginal: true };
const $ = id => document.getElementById(id);

const TEXT = {
  it: {
    title: 'Cinema per due — sottotitoli',
    engine: 'Traduzione',
    free: 'Google Traduttore (gratis, con riserve)',
    claude: 'Claude (migliore, serve chiave API)',
    key: 'Chiave API Anthropic',
    model: 'Modello',
    modelNote: 'claude-opus-5-5 traduce meglio; claude-haiku-4-5 è più rapido ed economico. Se Claude non risponde si usa Google.',
    hide: 'Nascondi i sottotitoli del sito (li vedete nella stanza)',
    langs: 'Lingue richieste dalla stanza',
    last: 'Ultima riga letta',
    tip: 'Nel player attiva i sottotitoli, in qualunque lingua: vengono tradotti nella lingua di ciascuno. Se una delle due lingue è già quella del player, arriva identica.',
  },
  th: {
    title: 'โรงหนังสำหรับสองคน — คำบรรยาย',
    engine: 'การแปล',
    free: 'Google แปลภาษา (ฟรี มีตัวสำรอง)',
    claude: 'Claude (แปลดีกว่า ต้องใช้คีย์ API)',
    key: 'คีย์ API ของ Anthropic',
    model: 'โมเดล',
    modelNote: 'claude-opus-5-5 แปลดีที่สุด claude-haiku-4-5 เร็วและถูกกว่า ถ้า Claude ไม่ตอบจะใช้ Google แทน',
    hide: 'ซ่อนคำบรรยายของเว็บ (ดูในห้องแทน)',
    langs: 'ภาษาที่ห้องต้องการ',
    last: 'บรรทัดล่าสุดที่อ่านได้',
    tip: 'เปิดคำบรรยายในเครื่องเล่น ภาษาอะไรก็ได้ ระบบจะแปลเป็นภาษาของแต่ละคน ถ้าตรงกับภาษาของเครื่องเล่นอยู่แล้วจะส่งไปตามเดิม',
  },
  en: {
    title: 'Cinema for two — subtitles',
    engine: 'Translation',
    free: 'Google Translate (free, with backups)',
    claude: 'Claude (better, needs an API key)',
    key: 'Anthropic API key',
    model: 'Model',
    modelNote: 'claude-opus-5-5 translates best; claude-haiku-4-5 is faster and cheaper. If Claude does not answer, Google is used.',
    hide: 'Hide the site\'s own subtitles (you see them in the room)',
    langs: 'Languages the room asks for',
    last: 'Last line read',
    tip: 'Turn on subtitles in the player, any language: they are translated into each person\'s language. A language that matches the player\'s comes through as it is.',
  },
};
const ui = TEXT[navigator.language.slice(0, 2)] || TEXT.en;
for (const el of document.querySelectorAll('[data-i]')) el.textContent = ui[el.dataset.i];
document.documentElement.lang = navigator.language.slice(0, 2);

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

function refresh() {
  chrome.storage.session.get({ lastLine: '', langs: ['it', 'th'] }, s => {
    $('last').textContent = s.lastLine || '—';
    $('langs').textContent = s.langs.join(', ');
  });
}
refresh();
setInterval(refresh, 500);
