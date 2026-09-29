// Room presence and message passing over Firebase Realtime Database.
//   homes/cinema-<code>/peers/<id>        who is in the room (removed on disconnect)
//   homes/cinema-<code>/inbox/<id>/<push> messages addressed to <id>, deleted once read

import { FIREBASE } from './config.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';

export async function openRoom(code, me) {
  const { initializeApp } = await import(`${SDK}/firebase-app.js`);
  const db = await import(`${SDK}/firebase-database.js`);
  const app = initializeApp(FIREBASE, 'cinema');
  const base = db.ref(db.getDatabase(app), `homes/cinema-${code}`);
  const meRef = db.child(base, `peers/${me.id}`);
  const inbox = db.child(base, `inbox/${me.id}`);

  await db.onDisconnect(meRef).remove();
  await db.onDisconnect(inbox).remove();
  await db.set(meRef, { name: me.name, lang: me.lang, t: db.serverTimestamp() });

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
    update(info) { return db.update(meRef, info); },
    leave() { return Promise.all([db.remove(meRef), db.remove(inbox)]); },
  };
}
