// Everything is synthesised with WebAudio. The context is created on the first toggle because
// browsers refuse to start audio without a user gesture.

export function createSound() {
  let ctx = null;
  let master = null;
  let on = false;
  let nextAmbientPlop = 0;

  function build() {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    const length = ctx.sampleRate * 4;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      data[i] = last * 3.5;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 380;
    filter.Q.value = 0.7;

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 160;
    lfo.connect(lfoDepth).connect(filter.frequency);

    const ambience = ctx.createGain();
    ambience.gain.value = 0.5;
    noise.connect(filter).connect(ambience).connect(master);
    noise.start();
    lfo.start();
  }

  function plop(when = 0, pitch = 1, volume = 0.22) {
    if (!on) return;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(260 * pitch, t);
    osc.frequency.exponentialRampToValueAtTime(820 * pitch, t + 0.09);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  return {
    get on() { return on; },

    async toggle() {
      if (!ctx) build();
      on = !on;
      if (on) await ctx.resume();
      master.gain.setTargetAtTime(on ? 0.8 : 0, ctx.currentTime, 0.4);
      return on;
    },

    entrance() {
      for (let i = 0; i < 7; i++) plop(i * 0.07 + Math.random() * 0.04, 0.8 + Math.random() * 0.7, 0.18);
    },

    tick(now) {
      if (!on || now < nextAmbientPlop) return;
      nextAmbientPlop = now + 2500 + Math.random() * 5000;
      plop(0, 0.7 + Math.random() * 0.6, 0.06);
    },
  };
}
