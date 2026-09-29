// Receives subtitle lines from the streaming tab, translates them into Italian and Thai,
// and hands them to every open Cinema per due tab.

const ROOM_TABS = ['https://notraikus.github.io/*', 'http://localhost/*', 'http://127.0.0.1/*'];
const SETTINGS = { engine: 'google', apiKey: '', model: 'claude-opus-5-5', hideOriginal: true };

const cache = new Map();   // original line -> {it, th}
const history = [];        // previous lines, context for Claude
let newest = 0;

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === 'line') onLine(msg, sender.tab?.id);
  if (msg.type === 'control') toStreamingTabs(msg);
});

async function onLine({ text, seq }, tabId) {
  const id = ++newest;
  chrome.storage.session.set({ lastLine: text, lastSite: tabId ? 'ok' : '' });
  if (!text) return toRooms({ type: 'sub', seq: id, orig: '', it: '', th: '' });

  const t = await translate(text).catch(e => {
    console.warn('translate', e);
    return { it: '', th: '' };
  });
  if (id !== newest && !t.fromCache) return; // a newer line arrived meanwhile: skip this one
  history.push(text);
  if (history.length > 8) history.shift();
  toRooms({ type: 'sub', seq: id, orig: text, it: t.it || text, th: t.th || text });
}

async function translate(text) {
  if (cache.has(text)) return { ...cache.get(text), fromCache: true };
  const s = await chrome.storage.local.get(SETTINGS);
  let out = null;
  if (s.engine === 'claude' && s.apiKey) out = await claude(text, s).catch(e => { console.warn('claude', e); return null; });
  if (!out) {
    const [it, th] = await Promise.all([google(text, 'it'), google(text, 'th')]);
    out = { it, th };
  }
  cache.set(text, out);
  if (cache.size > 2000) cache.delete(cache.keys().next().value);
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
const SYSTEM = `You translate film subtitles for an Italian man and a Thai woman who watch films together.
For each new subtitle line reply with exactly two lines and nothing else:
IT: <Italian translation>
TH: <Thai translation>
Write them like professional subtitles: natural spoken language, short, same meaning and tone.
Keep character names as they are. Where the original has a line break, write " / ".
If the line is already in Italian or Thai, copy it unchanged for that language.`;

async function claude(text, s) {
  const context = history.length ? `Previous lines, for context only:\n${history.join('\n')}\n\n` : '';
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
      messages: [{ role: 'user', content: `${context}Translate this line:\n${text.replace(/\n/g, ' / ')}` }],
    }),
  });
  if (!res.ok) throw new Error(`claude ${res.status}: ${await res.text()}`);
  const data = await res.json();
  if (data.stop_reason === 'refusal') return null;
  const reply = data.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
  const pick = tag => reply.match(new RegExp(`^${tag}:\\s*(.+)$`, 'm'))?.[1].trim().replace(/\s*\/\s*/g, '\n') || '';
  const out = { it: pick('IT'), th: pick('TH') };
  return out.it && out.th ? out : null;
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
