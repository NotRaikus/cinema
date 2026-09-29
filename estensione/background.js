// Receives subtitle lines from the streaming tab, translates them into the languages
// the room asks for (each person's subtitle language), and hands them to the room tabs.

const ROOM_TABS = ['https://notraikus.github.io/*', 'http://localhost/*', 'http://127.0.0.1/*'];
const SETTINGS = { engine: 'google', apiKey: '', model: 'claude-opus-5-5', hideOriginal: true };
const DEFAULT_LANGS = ['it', 'th'];
const NAMES = {
  it: 'Italian', th: 'Thai', en: 'English', es: 'Spanish', fr: 'French', de: 'German',
  pt: 'Portuguese', ru: 'Russian', ja: 'Japanese', ko: 'Korean', zh: 'Simplified Chinese', vi: 'Vietnamese',
};

const cache = new Map();   // "lang|line" -> translation
const history = [];        // previous lines, context for Claude
let newest = 0;

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === 'line') onLine(msg);
  if (msg.type === 'control') toStreamingTabs(msg);
  if (msg.type === 'langs' && msg.langs?.length) {
    const langs = msg.langs.filter(l => NAMES[l]);
    if (langs.length) chrome.storage.session.set({ langs });
  }
});

async function onLine({ text }) {
  const id = ++newest;
  chrome.storage.session.set({ lastLine: text });
  if (!text) return toRooms({ type: 'sub', seq: id, orig: '', tr: {} });

  const { langs } = await chrome.storage.session.get({ langs: DEFAULT_LANGS });
  const tr = await translate(text, langs).catch(e => {
    console.warn('translate', e);
    return {};
  });
  if (id !== newest) return; // a newer line arrived meanwhile: skip this one
  history.push(text);
  if (history.length > 8) history.shift();
  toRooms({ type: 'sub', seq: id, orig: text, tr });
}

// { lang: translation } for every requested language.
async function translate(text, langs) {
  const out = {};
  const missing = [];
  for (const l of langs) {
    const hit = cache.get(`${l}|${text}`);
    if (hit) out[l] = hit; else missing.push(l);
  }
  if (!missing.length) return out;

  const s = await chrome.storage.local.get(SETTINGS);
  let fresh = null;
  if (s.engine === 'claude' && s.apiKey) fresh = await claude(text, missing, s).catch(e => { console.warn('claude', e); return null; });
  if (!fresh) {
    const results = await Promise.all(missing.map(l => google(text, l).catch(() => '')));
    fresh = Object.fromEntries(missing.map((l, i) => [l, results[i]]));
  }
  for (const [l, v] of Object.entries(fresh)) {
    if (!v) continue;
    out[l] = v;
    cache.set(`${l}|${text}`, v);
  }
  while (cache.size > 4000) cache.delete(cache.keys().next().value);
  return out;
}

// Free translators, no key. Free endpoints get rate-limited (HTTP 429) without warning:
// that is what makes other subtitle extensions freeze. Here a blocked one is set aside
// for 10 minutes and the next one takes over.
const FREE = [
  {
    name: 'google-ext',
    url: (q, tl) => `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=${tl}&q=${q}`,
    read: d => (typeof d[0] === 'string' ? d[0] : d[0][0]),
  },
  {
    name: 'google-gtx',
    url: (q, tl) => `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${tl}&dt=t&q=${q}`,
    read: d => d[0].map(part => part[0]).join(''),
  },
  {
    name: 'mymemory',
    url: (q, tl) => `https://api.mymemory.translated.net/get?langpair=autodetect|${tl}&q=${q}`,
    read: d => d.responseData.translatedText,
  },
];
const blockedUntil = {};

async function google(text, target) {
  const q = encodeURIComponent(text);
  if (target === 'zh') target = 'zh-CN';
  for (const svc of FREE) {
    if (Date.now() < (blockedUntil[svc.name] || 0)) continue;
    try {
      const res = await fetch(svc.url(q, target), { signal: AbortSignal.timeout(4000) });
      if (!res.ok) throw new Error(`${svc.name} ${res.status}`);
      const out = svc.read(await res.json());
      if (out) return out;
    } catch (e) {
      console.warn(e);
      blockedUntil[svc.name] = Date.now() + 10 * 60_000;
    }
  }
  throw new Error('no free translator available');
}

// Claude: reads the previous lines too, so pronouns, tone and names come out right.
const SYSTEM = `You translate film subtitles for people who watch films together, each reading their own language.
For each new subtitle line reply with exactly one line per requested language code and nothing else, like:
it: <translation>
th: <translation>
Write them like professional subtitles: natural spoken language, short, same meaning and tone.
Keep character names as they are. Where the original has a line break, write " / ".
If the line is already in a requested language, copy it unchanged for that language.`;

async function claude(text, langs, s) {
  const context = history.length ? `Previous lines, for context only:\n${history.join('\n')}\n\n` : '';
  const wanted = langs.map(l => `${l} (${NAMES[l]})`).join(', ');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': s.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: s.model || SETTINGS.model,
      max_tokens: 1000,
      output_config: { effort: 'low' },
      system: SYSTEM,
      messages: [{ role: 'user', content: `${context}Languages: ${wanted}\nTranslate this line:\n${text.replace(/\n/g, ' / ')}` }],
    }),
  });
  if (!res.ok) throw new Error(`claude ${res.status}: ${await res.text()}`);
  const data = await res.json();
  if (data.stop_reason === 'refusal') return null;
  const reply = data.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
  const out = {};
  for (const l of langs) {
    const m = reply.match(new RegExp(`^${l}:\s*(.+)$`, 'mi'));
    if (!m) return null; // incomplete answer: let the free translators do it
    out[l] = m[1].trim().replace(/\s*\/\s*/g, '\n');
  }
  return out;
}

async function toRooms(msg) {
  for (const tab of await chrome.tabs.query({ url: ROOM_TABS })) {
    chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
  }
}

async function toStreamingTabs(msg) {
  for (const tab of await chrome.tabs.query({})) {
    if (/netflix|disneyplus|max\.com|hbomax|primevideo|amazon\.|youtube/.test(tab.url || '')) {
      chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
    }
  }
}
