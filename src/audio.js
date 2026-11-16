// RECLAIM audio: the soundscape is the progress bar you can hear. Wind first; insects, birds and music are earned.
const SFX = ['hit', 'powerup', 'click', 'splash', 'thud', 'blip'];
const FILES = {
  // integrated assets (Production Director)
  hit: 'assets/audio/hit.ogg', powerup: 'assets/audio/powerup.ogg', click: 'assets/audio/click.ogg', splash: 'assets/audio/splash.ogg', thud: 'assets/audio/thud.ogg', blip: 'assets/audio/blip.ogg',
  wind: 'assets/audio/ambience_wind.ogg', forest: 'assets/audio/ambience_forest.ogg', fanfare: 'assets/audio/music.ogg',
  // the quiet layers
  night: 'audio/ambience_night.ogg', rain: 'audio/ambience_rain.ogg', pad: 'audio/music_pad.ogg', bass: 'audio/music_bass.ogg', arp: 'audio/music_arp.ogg',
};

export class GameAudio {
  constructor() { this.ctx = null; this.buf = {}; this.loops = {}; this.muted = false; this.ready = false; this.want = {}; this.lastRustle = 0; }
  // call from the first user gesture (autoplay policy)
  async start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    this.ctx = new AC(); this.master = this.ctx.createGain(); this.master.gain.value = this.muted ? 0 : 1; this.master.connect(this.ctx.destination);
    const ogg = new Audio().canPlayType('audio/ogg; codecs="vorbis"') !== '';
    const url = k => ogg ? FILES[k] : `audio/mp3/${FILES[k].split('/').pop().replace('.ogg', '.mp3')}`;   // browsers without Ogg Vorbis get the mp3 transcodes
    const load = async k => {
      try { const r = await fetch(url(k)); const a = await r.arrayBuffer(); this.buf[k] = await new Promise((res, rej) => this.ctx.decodeAudioData(a, res, rej)); } catch (e) { /* a missing sound must never stop the game */ }
    };
    await Promise.all(SFX.map(load)); this.ready = true;
    await load('wind'); this.loop('wind', this.want.wind ?? 0.5);
    for (const k of ['night', 'forest', 'rain', 'fanfare']) { await load(k); if (this.want[k]) this.loop(k, this.want[k]); }
    await Promise.all(['pad', 'bass', 'arp'].map(load));
    if (this.buf.pad && this.buf.bass && this.buf.arp) { const at = this.ctx.currentTime + 0.1; for (const k of ['pad', 'bass', 'arp']) this.loop(k, this.want[k] || 0, at); }
  }
  play(k, { gain = 1, rate = 1, delay = 0 } = {}) {
    if (!this.ctx || !this.buf[k]) return;
    const s = this.ctx.createBufferSource(), g = this.ctx.createGain(); s.buffer = this.buf[k]; s.playbackRate.value = rate; g.gain.value = gain; s.connect(g); g.connect(this.master); s.start(this.ctx.currentTime + delay);
  }
  loop(k, gain, at) {
    if (!this.ctx || !this.buf[k] || this.loops[k]) return;
    const s = this.ctx.createBufferSource(), g = this.ctx.createGain(); s.buffer = this.buf[k]; s.loop = true; g.gain.value = 0; s.connect(g); g.connect(this.master); s.start(at || 0);
    this.loops[k] = g; this.level(k, gain, 3);
  }
  level(k, gain, secs = 4) {
    this.want[k] = gain; const g = this.loops[k];
    if (!g) { if (gain > 0 && this.buf[k] && !['pad', 'bass', 'arp'].includes(k)) this.loop(k, gain); return; }
    const t = this.ctx.currentTime; g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(gain, t + secs);
  }
  // leaves moving: a short band of noise, pitched by how fast the vine is growing
  rustle(speed) {
    if (!this.ctx || this.muted) return; const t = this.ctx.currentTime; if (t - this.lastRustle < 0.07) return; this.lastRustle = t;
    if (!this.noise) { const b = this.ctx.createBuffer(1, 4096, this.ctx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; this.noise = b; }
    const s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain(); s.buffer = this.noise; f.type = 'bandpass'; f.frequency.value = 2200 + speed * 2600 + Math.random() * 900; f.Q.value = 1.4;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05 + speed * 0.05, t + 0.012); g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t); s.stop(t + 0.1);
  }
  // concrete under strain
  creak() {
    if (!this.ctx || this.muted) return; const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain(); o.type = 'sawtooth'; o.frequency.setValueAtTime(70 + Math.random() * 30, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.22);
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.16, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + 0.26); o.connect(f); f.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.3);
  }
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.05); }
  suspend(on) { if (!this.ctx) return; if (on) this.ctx.suspend(); else this.ctx.resume(); }
}
