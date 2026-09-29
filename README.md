# Cinema per due

Film insieme a distanza (Italia ↔ Thailandia): condivisione della scheda di
Netflix / Disney+ / HBO Max / Prime Video, webcam e microfono, sottotitoli
nella lingua di ciascuno.

## Come è fatto

- `index.html`, `style.css`, `js/`: il sito. HTML e moduli JavaScript, nessuna build.
  - `js/signal.js`: Firebase (lo stesso progetto gratuito di Halfway Home) fa solo
    da centralino, sotto `homes/cinema-<codice>`: i due browser si trovano e si
    scambiano i dati di connessione.
  - `js/rtc.js`: collegamento diretto WebRTC tra i due. Film fino a 6 Mbit/s a 30 fps,
    audio del film in stereo a 192 kbit/s, canale dati per sottotitoli e play/pausa.
  - `js/app.js`: stanza, webcam, sottotitoli, finestra mobile.
- `estensione/`: estensione di Chrome, **solo sul PC di chi condivide il film**
  (può essere l'uno o l'altra: basta che l'abbia chi condivide).
  Legge i sottotitoli ufficiali mentre il player li mostra, in qualunque lingua,
  e li traduce nella lingua che ognuno ha scelto nella stanza (italiano, thai,
  inglese e altre nove). Nasconde quelli del sito, così non si vedono doppi.
  Si scarica anche dalla stanza: Impostazioni → "Scarica l'estensione".

Perché i sottotitoli ufficiali e non il riconoscimento dell'audio: sono già scritti
bene e già a tempo col film. Tradurre un testo pulito viene molto meglio che
trascrivere l'audio e poi tradurlo.

## Serata film, passo per passo

Chi condivide (PC con Chrome):
1. Una volta sola: Chrome → Impostazioni → Sistema → disattiva
   **"Usa accelerazione grafica se disponibile"** e riavvia. Senza questo
   Netflix e gli altri arrivano neri all'altra persona (protezione DRM).
2. Una volta sola: installa l'estensione (vedi sotto).
3. Apri il film su Netflix e **attiva i sottotitoli** del player (inglese, o
   direttamente thai/italiano se ci sono: in quel caso arrivano identici, senza traduzione).
4. Apri la stanza, **Condividi film**, scegli la scheda di Netflix e spunta
   **"Condividi anche l'audio della scheda"**.
5. Meglio con le cuffie: il microfono così non rimanda l'audio del film.
6. **Finestra mobile**: webcam e sottotitoli restano sopra Netflix mentre guardi lì.

Chi guarda (PC, iPhone o iPad): apre il link, mette nome e lingua, entra.
Play/pausa funziona da tutti e due.

## Installare l'estensione

1. Chrome → `chrome://extensions` → attiva **Modalità sviluppatore** (in alto a destra).
2. **Carica estensione non pacchettizzata** → scegli la cartella `estensione`.
3. Dall'icona dell'estensione scegli la traduzione:
   - **Google Traduttore** (gratis): usa tre servizi gratuiti in fila; se uno
     blocca le richieste, passa al successivo invece di fermarsi.
   - **Claude** (serve una chiave API Anthropic): legge anche le battute
     precedenti, quindi tono, pronomi e nomi escono giusti. Costa pochi centesimi a film.

## Provarlo sul PC

```bash
python -m http.server 8322 --directory coppia
```

Poi `http://localhost:8322/cinema/`: due schede con lo stesso link sono le due persone.

## Limiti noti

- Il collegamento diretto può non riuscire se una delle due reti lo blocca
  (alcuni operatori mobili, wifi di hotel e uffici). Si risolve con un relay TURN
  in `js/config.js`: il gratuito di Metered o Cloudflare basta per due persone.
- I selettori dei sottotitoli di Disney+ e HBO Max cambiano quando i siti
  aggiornano il player: se lì smettono di arrivare, sono da ritoccare in
  `estensione/streaming.js`. Netflix e YouTube sono i più stabili.
- La stanza è per due persone: una terza viene ignorata.
