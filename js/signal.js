// Room presence and message passing over Firebase Realtime Database.
//   homes/cinema-<code>/peers/<id>        who is in the room (removed on disconnect)
//   homes/cinema-<code>/inbox/<id>/<push> messages addressed to <id>, deleted once read

import { FIREBASE } from './config.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';

let conn = null;
async function connect() {
  if (!conn) {
    conn = (async () => {
      const { initializeApp } = await import(`${SDK}/firebase-app.js`);
      const db = await import(`${SDK}/firebase-database.js`);
      const app = initializeApp(FIREBASE, 'cinema');
      return { db, app, root: db.getDatabase(app) };
    })();
  }
  return conn;
}

// ---------- profiles ----------
//   homes/cinema-users/<nickname>  { name, lang, key, t }
// "key" is the SHA-256 of a secret that only the browser that created the profile keeps:
// whoever has the secret can update the profile, nobody else can take the nickname.

export const HANDLE = /^[a-z0-9_]{3,20}$/;

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function lookupHandle(handle) {
  const { db, root } = await connect();
  const snap = await db.get(db.ref(root, `homes/cinema-users/${handle}`));
  return snap.val();
}

// Resolves true when the nickname is now ours, false when someone else has it.
export async function claimHandle(handle, { name, lang, secret }) {
  const { db, root } = await connect();
  const key = await sha256(secret);
  const res = await db.runTransaction(db.ref(root, `homes/cinema-users/${handle}`), cur => {
    if (cur && cur.key !== key) return; // taken: abort
    return { name, lang, key, t: Date.now() };
  });
  return res.committed;
}

// ---------- room ----------

export async function openRoom(code, me) {
  const { db, app } = await connect();
  const base = db.ref(db.getDatabase(app), `homes/cinema-${code}`);
  const meRef = db.child(base, `peers/${me.id}`);
  const inbox = db.child(base, `inbox/${me.id}`);

  const info = { name: me.name, handle: me.handle || '', lang: me.lang };
  const register = async () => {
    await db.onDisconnect(meRef).remove();
    await db.onDisconnect(inbox).remove();
    await db.set(meRef, { ...info, t: db.serverTimestamp() });
  };
  await register();
  // After a network hiccup Firebase has already removed us (onDisconnect): sign back in.
  let first = true;
  db.onValue(db.ref(db.getDatabase(app), '.info/connected'), snap => {
    if (snap.val() === true && !first) register().catch(e => console.warn('presence', e));
    if (snap.val() === true) first = false;
  });

  return {
    // cb(peers) with every other person currently in the room: { id: {name, lang} }
    onPeers(cb) {
      return db.onValue(db.child(base, 'peers'), snap => {
        const all = snap.val() || {};
        delete all[me.id];
        cb(all);
      });
    },
    onMessage(cb) {
      return db.onChildAdded(inbox, snap => {
        const msg = snap.val();
        db.remove(snap.ref);
        if (msg) cb(msg.from, JSON.parse(msg.data));
      });
    },
    send(to, data) {
      return db.push(db.child(base, `inbox/${to}`), { from: me.id, data: JSON.stringify(data) });
    },
    update(changes) { Object.assign(info, changes); return db.update(meRef, changes); },
    leave() { return Promise.all([db.remove(meRef), db.remove(inbox)]); },
  };
}
