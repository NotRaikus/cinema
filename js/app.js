import { TEXT, LANGS } from './i18n.js';
import { openRoom } from './signal.js';
import { Peer } from './rtc.js';

// Cached: some elements move into the floating window and must still be found.
const cache = {};
const $ = id => (cache[id] ??= document.getElementById(id));

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('cinema.' + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('cinema.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};

const me = {
  id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
  name: store.get('name', ''),
  lang: store.get('lang', LANGS[navigator.language?.slice(0, 2)] ? navigator.language.slice(0, 2) : 'it'),
};
const prefs = { showOrig: store.get('showOrig', false), subDelay: store.get('subDelay', 0.3) };

// The room code travels in the link: ?stanza=xxxxxxxxxx
const params = new URLSearchParams(location.search);
let code = params.get('stanza');
if (!code || code.length < 10) {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  code = Array.from(crypto.getRandomValues(new Uint8Array(10)), b => abc[b % abc.length]).join('');
  params.set('stanza', code);
  history.replaceState(null, '', `${location.pathname}?${params}`);
}

let signal = null;
let peer = null, peerId = null, peerInfo = null;
let camStream = null;   // my webcam + mic
let filmStream = null;  // the tab I am sharing
let remoteFilmId = null;
const remote = new Map(); // stream id -> MediaStream received from the other side
let extension = false;
let lastSub = null;
let remoteLang = null; // the other person's subtitle language, also told over the data channel

const t = key => (TEXT[me.lang] || TEXT.en)[key] ?? TEXT.en[key] ?? key;

for (const sel of [$('langPick'), $('langPick2')]) {
  for (const [code, label] of Object.entries(LANGS)) sel.add(new Option(label, code));
  sel.onchange = () => setLang(sel.value);
}

function applyText() {
  document.documentElement.lang = me.lang;
  document.title = t('title');
  for (const el of document.querySelectorAll('[data-t]')) el.textContent = t(el.dataset.t);
  for (const el of document.querySelectorAll('[data-tip]')) { el.title = t(el.dataset.tip); el.setAttribute('aria-label', t(el.dataset.tip)); }
  $('langPick').value = $('langPick2').value = me.lang;
  $('btnShare').querySelector('span').textContent = t(filmStream ? 'stopShare' : 'share');
  $('shareTip').textContent = canShare() ? t('shareHint') : t('noShare');
  $('extState').textContent = t(extension ? 'ext' : 'extMissing');
  $('delayVal').textContent = `${prefs.subDelay.toFixed(1)} s`;
  showStatus();
  if (lastSub) renderSub(lastSub);
}

function toast(msg, ms = 4000) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), ms);
}

const canShare = () => !!navigator.mediaDevices?.getDisplayMedia && !/iPhone|iPad|Android/i.test(navigator.userAgent);

function setLang(lang) {
  me.lang = lang;
  store.set('lang', lang);
  signal?.update({ lang });
  peer?.data({ type: 'lang', lang });
  applyText();
  tellExtensionLangs();
}

// The extension of whoever shares translates into the languages the two of us read.
function tellExtensionLangs() {
  const langs = [...new Set([me.lang, remoteLang || peerInfo?.lang].filter(Boolean))];
  toExtension({ type: 'langs', langs });
}

// ---------- lobby ----------

$('name').value = me.name;
$('enter').onclick = join;
$('name').onkeydown = e => { if (e.key === 'Enter') join(); };
applyText();

async function join() {
  me.name = $('name').value.trim() || (me.lang === 'th' ? 'เธอ' : 'Io');
  store.set('name', me.name);
  $('enter').disabled = true;
  $('lobbyNote').textContent = t('joining');

  camStream = await navigator.mediaDevices?.getUserMedia({
    video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  }).catch(() => navigator.mediaDevices.getUserMedia({ audio: true })).catch(() => null);
  if (!camStream) toast(t('noCam'), 6000);
  $('camLocal').srcObject = camStream;
  $('localBox').hidden = !camStream?.getVideoTracks().length;
  $('btnMic').disabled = !camStream?.getAudioTracks().length;
  $('btnCam').disabled = !camStream?.getVideoTracks().length;

  try {
    signal = await openRoom(code, me);
  } catch (e) {
    console.error(e);
    $('lobbyNote').textContent = String(e.message || e);
    $('enter').disabled = false;
    return;
  }
  $('lobby').hidden = true;
  $('room').hidden = false;
  $('btnShare').hidden = !canShare();
  $('btnFloat').hidden = !('documentPictureInPicture' in window);

  signal.onMessage(onSignal);
  signal.onPeers(peers => {
    lastPeers = peers;
    // Someone missing from the list may just have had a hiccup: give them a few seconds.
    if (peerId && !peers[peerId]) {
      absentTimer ??= setTimeout(() => {
        absentTimer = null;
        // Still watching together? Then it was only the switchboard: carry on.
        if (peerId && !lastPeers[peerId] && connState !== 'connected') {
          toast(`${peerInfo?.name || ''} ${t('left')}`);
          dropPeer();
          connectToAny();
        }
      }, 8000);
    } else {
      clearTimeout(absentTimer);
      absentTimer = null;
    }
    if (!peerId) connectToAny();
    peerInfo = peerId ? peers[peerId] || peerInfo : null;
    $('remoteName').textContent = peerInfo?.name || '';
    tellExtensionLangs();
    showStatus();
  });
  window.addEventListener('pagehide', () => { peer?.data({ type: 'bye' }); signal.leave(); });
  showStatus();
  setInterval(updateStats, 3000);
}

// ---------- connection ----------
// The two sides must always agree on which connection is the current one, even after a
// network hiccup or a reload. So one side (the "leader": the smaller id) owns the session:
// only the leader opens a new one, the other side follows. Every signaling message carries
// the session number, and leftovers from an older session are ignored.

let connState = 'new';
let stats = null;
let lastPeers = {};
let absentTimer = null;
let session = 0;
let sessionStart = 0;

const leaderIsMe = other => me.id < other;

function connectToAny() {
  const id = Object.keys(lastPeers)[0];
  if (!id) return;
  peerId = id;
  peerInfo = lastPeers[id];
  if (leaderIsMe(id)) newSession();
  else signal.send(id, { hello: true }); // ask the leader for a session
}

function newSession() {
  closePeer();
  session = Date.now();
  sessionStart = Date.now();
  createPeer();
}

function createPeer() {
  const id = peerId, sess = session;
  peer = new Peer({
    // The film id rides along with every message: the other side always knows which
    // incoming video is the film and which is the webcam.
    send: data => signal.send(id, { ...data, sess, film: filmStream?.id || null }),
    polite: !leaderIsMe(id),
    onTrack,
    onData,
    onState: s => {
      if (s === 'channel') {
        peer.data({ type: 'film', id: filmStream?.id || null });
        peer.data({ type: 'lang', lang: me.lang });
      }
      else connState = s;
      if (s === 'disconnected' || s === 'failed') stats = null;
      if (s === 'failed') setTimeout(recover, 1000);
      showStatus();
    },
  });
  peer.setStream('cam', camStream);
  if (filmStream) peer.setStream('film', filmStream);
}

function recover() {
  if (!peerId || connState !== 'failed') return;
  if (leaderIsMe(peerId)) newSession();
  else signal.send(peerId, { hello: true });
}

function closePeer() {
  peer?.close();
  peer = null;
  remote.clear();
  remoteFilmId = null;
  connState = 'new';
  stats = null;
}

function dropPeer() {
  closePeer();
  peerId = peerInfo = remoteLang = null;
  session = 0;
  route();
  showStatus();
}

async function onSignal(from, data) {
  if (from !== peerId) {
    // A new arrival (the other person reloaded, or came back): the room is for two, they take the place.
    const fromLeader = data.sess && !leaderIsMe(from);
    if (!data.hello && !fromLeader) return;
    dropPeer();
    peerId = from;
    peerInfo = lastPeers[from] || null;
  }
  if (leaderIsMe(from)) {
    if (data.hello) {
      // The follower lost its connection (or just arrived): open a fresh one,
      // unless the current one was opened a moment ago and is still on its way.
      if (!peer || Date.now() - sessionStart > 5000) newSession();
      return;
    }
    if (data.sess !== session) return; // leftover from an old session
  } else {
    if (!data.sess || data.sess < session) return;
    if (data.sess > session) { closePeer(); session = data.sess; createPeer(); }
  }
  if ('film' in data && data.film !== remoteFilmId) { remoteFilmId = data.film; route(); }
  try { await peer.receive(data); } catch (e) { console.warn('signal', e); }
  showStatus();
}

function showStatus() {
  const el = $('status');
  if (!el || !signal) return;
  let text, cls;
  if (!peerId) { text = t('waitingSomeone'); cls = 'wait'; }
  else if (connState === 'connected') {
    text = `${t('connected')} · ${peerInfo?.name || ''}`;
    if (stats?.rtt != null) text += ` · ${Math.round(stats.rtt * 1000)} ms`;
    if (stats?.relay) text += ` · ${t('relay')}`;
    cls = 'ok';
  } else if (connState === 'disconnected' || connState === 'failed') { text = t('lost'); cls = 'bad'; }
  else { text = `${t('connecting')} ${peerInfo?.name || ''}`; cls = 'wait'; }
  $('statusText').textContent = text;
  el.className = cls;
}

async function updateStats() {
  if (peer && connState === 'connected') { stats = await peer.stats(); showStatus(); }
}

function onTrack(track, stream) {
  if (!stream) return;
  remote.set(stream.id, stream);
  const tidy = () => {
    if (!stream.getTracks().some(tr => tr.readyState === 'live')) remote.delete(stream.id);
    route();
  };
  stream.onremovetrack = tidy;
  track.onended = tidy;
  route();
}

function onData(msg) {
  if (msg.type === 'film') { remoteFilmId = msg.id; route(); }
  else if (msg.type === 'bye') dropPeer();
  else if (msg.type === 'lang') { remoteLang = msg.lang; tellExtensionLangs(); }
  else if (msg.type === 'sub') showSub(msg, true);
  else if (msg.type === 'control' && filmStream) toExtension({ type: 'control', action: msg.action });
}

// Put every stream in its place: the film on the big screen, the other person in the bubble.
function route() {
  let remoteCam = null, remoteFilm = null;
  for (const [id, s] of remote) {
    if (id === remoteFilmId) remoteFilm = s; else remoteCam = s;
  }
  const film = $('film');
  const want = filmStream || remoteFilm;
  if (film.srcObject !== want) {
    film.srcObject = want;
    film.muted = !!filmStream; // the sharer already hears the tab itself
    if (want) play(film);
    if (want && !filmStream && !document.fullscreenElement) toast(t('fullHint'), 6000);
  }
  $('room').classList.toggle('watching', !!want);
  if (!want) $('room').classList.remove('idle');
  film.volume = +$('volFilm').value;
  $('placeholder').hidden = !!want;
  $('btnPlay').disabled = !want || (!!filmStream && !extension);

  const cam = $('camRemote');
  if (cam.srcObject !== remoteCam) { cam.srcObject = remoteCam; if (remoteCam) play(cam); }
  cam.volume = +$('volVoice').value;
  $('remoteBox').hidden = !remoteCam;
}

// Phones block sound until the user taps: ask for one tap if needed.
function play(video) {
  video.play().catch(() => {
    toast('▶ Tap / แตะ', 60000);
    document.addEventListener('pointerdown', () => { video.play(); $('toast').classList.remove('show'); }, { once: true });
  });
}

// ---------- film sharing ----------

$('btnShare').onclick = () => (filmStream ? stopShare() : startShare());

async function startShare() {
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false },
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
      systemAudio: 'include',
    });
  } catch { return; } // cancelled in the picker
  const [video] = stream.getVideoTracks();
  const [audio] = stream.getAudioTracks();
  video.contentHint = 'motion';
  if (audio) audio.contentHint = 'music';
  else toast(t('shareHint'), 8000);
  video.onended = stopShare;
  filmStream = stream;
  peer?.setStream('film', stream);
  peer?.data({ type: 'film', id: stream.id });
  applyText();
  route();
  if (!store.get('blackTipShown', false)) { toast(t('black'), 12000); store.set('blackTipShown', true); }
  else toast(t('youtubeTip'), 8000);
}

function stopShare() {
  filmStream?.getTracks().forEach(tr => tr.stop());
  filmStream = null;
  peer?.setStream('film', null);
  peer?.data({ type: 'film', id: null });
  applyText();
  route();
}

$('btnPlay').onclick = () => {
  if (filmStream) toExtension({ type: 'control', action: 'toggle' });
  else peer?.data({ type: 'control', action: 'toggle' });
};

// ---------- subtitles ----------
// The extension on the sharer's PC reads the official subtitles of the streaming site,
// translates them and hands them to this page; the page shows them and sends them over.

function toExtension(msg) { window.postMessage({ source: 'cinema-page', ...msg }, location.origin); }

window.addEventListener('message', e => {
  if (e.source !== window || e.data?.source !== 'cinema-ext') return;
  const msg = e.data;
  if (msg.type === 'hello') { extension = true; applyText(); route(); tellExtensionLangs(); }
  if (msg.type === 'sub') {
    const sub = { type: 'sub', seq: msg.seq, orig: msg.orig, tr: msg.tr || {} };
    showSub(sub, false);
    peer?.data(sub);
  }
});
toExtension({ type: 'ping' });

// Subtitles from the other side wait a moment: the video travels a little slower than the text.
function showSub(sub, fromRemote) {
  const delay = fromRemote ? prefs.subDelay * 1000 : 0;
  setTimeout(() => { lastSub = sub; renderSub(sub); }, delay);
}

function renderSub(sub) {
  const main = sub.tr?.[me.lang] || sub.orig || '';
  const orig = prefs.showOrig && sub.orig && sub.orig !== main ? sub.orig : '';
  const box = $('subs');
  box.querySelector('.main').textContent = main;
  box.querySelector('.orig').textContent = orig;
  box.classList.toggle('empty', !main);
}

// ---------- controls ----------

function toggleTrack(kind, btn) {
  const tracks = kind === 'audio' ? camStream?.getAudioTracks() : camStream?.getVideoTracks();
  if (!tracks?.length) return;
  const on = !tracks[0].enabled;
  tracks.forEach(tr => { tr.enabled = on; });
  btn.classList.toggle('on', on);
  btn.classList.toggle('off', !on);
  if (kind === 'video') $('localBox').classList.toggle('muted', !on);
}
$('btnMic').onclick = () => toggleTrack('audio', $('btnMic'));
$('btnCam').onclick = () => toggleTrack('video', $('btnCam'));
$('volFilm').oninput = route;
$('volVoice').oninput = route;

$('btnLink').onclick = async () => {
  try { await navigator.clipboard.writeText(location.href); toast(t('copied')); }
  catch { prompt(t('copyLink'), location.href); }
};

// Full screen takes the whole room (film, subtitles, webcams and the controls that fade out).
function toggleFull() {
  const room = $('room');
  if (document.fullscreenElement) document.exitFullscreen();
  else if (room.requestFullscreen) room.requestFullscreen().catch(() => {});
  else $('film').webkitEnterFullscreen?.(); // iPhone: only the video element can go full screen
}
$('btnFull').onclick = toggleFull;
$('stage').ondblclick = e => { if (!e.target.closest('#cams')) toggleFull(); };

// While a film is on, the controls hide after 3 s without moving the mouse or touching.
let idleTimer = null;
function wake() {
  const room = $('room');
  room.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (room.classList.contains('watching') && !$('settings').open && !room.querySelector('#bar:hover')) room.classList.add('idle');
  }, 3000);
}
for (const ev of ['pointermove', 'pointerdown', 'keydown']) document.addEventListener(ev, wake);

// Floating window (Chrome): webcams and subtitles float above Netflix while you watch there.
$('btnFloat').onclick = async () => {
  if (window.documentPictureInPicture.window) { window.documentPictureInPicture.window.close(); return; }
  const pip = await window.documentPictureInPicture.requestWindow({ width: 380, height: 420 });
  for (const sheet of document.styleSheets) {
    try {
      const style = pip.document.createElement('style');
      style.textContent = [...sheet.cssRules].map(r => r.cssText).join('\n');
      pip.document.head.append(style);
    } catch {
      const link = pip.document.createElement('link');
      link.rel = 'stylesheet';
      link.href = sheet.href;
      pip.document.head.append(link);
    }
  }
  pip.document.body.className = 'pip';
  pip.document.body.append($('cams'), $('subs'));
  for (const v of pip.document.querySelectorAll('video')) v.play().catch(() => {});
  toast(t('floatHint'));
  pip.addEventListener('pagehide', () => {
    $('stage').append($('subs'), $('cams'));
    for (const v of $('stage').querySelectorAll('video')) v.play().catch(() => {});
  });
};

$('btnSettings').onclick = () => {
  $('showOrig').checked = prefs.showOrig;
  $('subDelay').value = prefs.subDelay;
  $('settings').showModal();
};
$('showOrig').onchange = e => { prefs.showOrig = e.target.checked; store.set('showOrig', prefs.showOrig); applyText(); };
$('subDelay').oninput = e => { prefs.subDelay = +e.target.value; store.set('subDelay', prefs.subDelay); applyText(); };
