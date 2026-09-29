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

  const info = { name: me.name, lang: me.lang };
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
