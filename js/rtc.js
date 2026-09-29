// One direct connection to the other person (WebRTC, "perfect negotiation" pattern:
// both sides may add or remove tracks at any time and renegotiation sorts itself out).

import { ICE_SERVERS, FILM } from './config.js';

// Ask the other side for stereo, high-bitrate Opus so the film does not sound like a phone call.
function hifiAudio(sdp) {
  const pt = sdp.match(/a=rtpmap:(\d+) opus\/48000/i)?.[1];
  if (!pt) return sdp;
  return sdp.replace(new RegExp(`a=fmtp:${pt} (.*)`), (line, params) => {
    const clean = params.split(';').filter(p => !/^(stereo|sprop-stereo|maxaveragebitrate)=/.test(p)).join(';');
    return `a=fmtp:${pt} ${clean};stereo=1;sprop-stereo=1;maxaveragebitrate=${FILM.audioBitrate}`;
  });
}

export class Peer {
  // send(data): delivers a signaling message to the other side
  // polite: exactly one of the two must be polite (it gives way when both offer at once)
  constructor({ send, polite, onTrack, onData, onState }) {
    this.send = send;
    this.polite = polite;
    this.makingOffer = false;
    this.ignoreOffer = false;
    this.senders = { cam: [], film: [] };

    const pc = this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        await pc.setLocalDescription();
        this.sendDescription();
      } catch (e) { console.warn('negotiation', e); }
      finally { this.makingOffer = false; }
    };
    pc.onicecandidate = ({ candidate }) => { if (candidate) send({ candidate: candidate.toJSON() }); };
    pc.ontrack = e => onTrack(e.track, e.streams[0]);
    pc.onconnectionstatechange = () => onState(pc.connectionState);

    // Both sides open channel 0 themselves: nobody has to "create" it first.
    this.channel = pc.createDataChannel('dati', { negotiated: true, id: 0 });
    this.channel.onmessage = e => onData(JSON.parse(e.data));
    this.channel.onopen = () => onState('channel');
  }

  sendDescription() {
    const { type, sdp } = this.pc.localDescription;
    this.send({ description: { type, sdp: hifiAudio(sdp) } });
  }

  async receive({ description, candidate }) {
    const pc = this.pc;
    if (description) {
      const collision = description.type === 'offer' && (this.makingOffer || pc.signalingState !== 'stable');
      this.ignoreOffer = !this.polite && collision;
      if (this.ignoreOffer) return;
      await pc.setRemoteDescription(description);
      if (description.type === 'offer') {
        await pc.setLocalDescription();
        this.sendDescription();
      }
    } else if (candidate) {
      try { await pc.addIceCandidate(candidate); }
      catch (e) { if (!this.ignoreOffer) console.warn('candidate', e); }
    }
  }

  data(msg) {
    if (this.channel.readyState === 'open') this.channel.send(JSON.stringify(msg));
  }

  // kind: 'cam' (webcam + mic) or 'film' (shared tab). Replaces whatever was sent before.
  setStream(kind, stream) {
    for (const s of this.senders[kind]) this.pc.removeTrack(s);
    this.senders[kind] = [];
    if (!stream) return;
    for (const track of stream.getTracks()) {
      const sender = this.pc.addTrack(track, stream);
      this.senders[kind].push(sender);
      if (kind === 'film' && track.kind === 'video') this.tuneFilm(sender);
    }
  }

  async tuneFilm(sender) {
    const p = sender.getParameters();
    p.encodings = p.encodings?.length ? p.encodings : [{}];
    p.encodings[0].maxBitrate = FILM.maxBitrate;
    p.encodings[0].maxFramerate = FILM.maxFramerate;
    p.degradationPreference = 'maintain-resolution';
    try { await sender.setParameters(p); } catch (e) { console.warn('film params', e); }
  }

  async stats() {
    let rtt = null, lost = 0, received = 0, relay = false;
    const report = await this.pc.getStats();
    report.forEach(s => {
      if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') {
        rtt = s.currentRoundTripTime;
        relay = report.get(s.localCandidateId)?.candidateType === 'relay';
      }
      if (s.type === 'inbound-rtp' && s.kind === 'video') { lost += s.packetsLost || 0; received += s.packetsReceived || 0; }
    });
    return { rtt, relay, loss: received ? lost / (lost + received) : 0 };
  }

  close() { this.pc.close(); }
}
