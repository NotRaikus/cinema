// Firebase is only the "switchboard": the two browsers use it to find each other
// and exchange connection details, then video and audio travel directly between them.
// Same free project as Halfway Home; the database rules only allow paths under
// homes/<id of 10+ chars>, so rooms live at homes/cinema-<code>.
export const FIREBASE = {
  apiKey: 'AIzaSyAOyt4IR6_BTQnZyRh-Sz89bPWbAjHuBdo',
  authDomain: 'halfway-home-874ed.firebaseapp.com',
  databaseURL: 'https://halfway-home-874ed-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'halfway-home-874ed',
  storageBucket: 'halfway-home-874ed.firebasestorage.app',
  messagingSenderId: '1018687111547',
  appId: '1:1018687111547:web:d5c8cfce96fa7fd61bfdde',
};

// STUN finds the public address of each side. It is enough on most home networks.
// When one of the two networks blocks direct connections (some mobile carriers,
// hotel and office wifi) a TURN relay is needed: add it here, e.g. a free
// Metered or Cloudflare account:
//   { urls: 'turn:<host>:443?transport=tcp', username: '...', credential: '...' }
export const ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];

// Film quality sent to the other side.
export const FILM = {
  maxBitrate: 6_000_000, // bit/s: 1080p looks clean around 4-6 Mbit
  maxFramerate: 30,
  audioBitrate: 192_000, // stereo film audio
};
