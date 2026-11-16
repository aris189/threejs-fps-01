// All sound is synthesized with WebAudio — no audio files, no network.
// Each effect is a few oscillators or a filtered noise burst. The context is
// created lazily on the first user gesture; every call is guarded so a
// headless screenshot run never throws.
export function createAudio() {
  let ctx = null;
  let master = null;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return ctx;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.32;
      master.connect(ctx.destination);
    } catch {
      ctx = null;
    }
    return ctx;
  }

  function noiseBuffer(duration) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  function burst({ duration, filterFreq, type = 'lowpass', gain = 0.5, decay = 0.08 }) {
    if (!ensure()) return;
    try {
      const t = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(duration);
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = filterFreq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + decay);
      src.connect(filter).connect(g).connect(master);
      src.start(t);
      src.stop(t + duration);
    } catch { /* audio is cosmetic */ }
  }

  function tone({ freq, freqEnd, duration, type = 'sine', gain = 0.3, when = 0 }) {
    if (!ensure()) return;
    try {
      const t = ctx.currentTime + when;
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      if (freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t + duration);
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + duration);
      osc.connect(g).connect(master);
      osc.start(t);
      osc.stop(t + duration + 0.02);
    } catch { /* audio is cosmetic */ }
  }

  return {
    unlock() { ensure(); },
    shot(kind) {
      if (kind === 'rifle') { burst({ duration: 0.12, filterFreq: 1800, gain: 0.7, decay: 0.09 }); tone({ freq: 160, freqEnd: 60, duration: 0.1, type: 'square', gain: 0.25 }); }
      else if (kind === 'smg') { burst({ duration: 0.09, filterFreq: 2400, gain: 0.5, decay: 0.06 }); }
      else if (kind === 'dmr') { burst({ duration: 0.22, filterFreq: 1200, gain: 0.9, decay: 0.16 }); tone({ freq: 120, freqEnd: 45, duration: 0.18, type: 'square', gain: 0.35 }); }
      else { burst({ duration: 0.1, filterFreq: 2000, gain: 0.55, decay: 0.07 }); }
    },
    enemyShot(distance) {
      const g = Math.max(0.08, 0.5 - distance * 0.008);
      burst({ duration: 0.1, filterFreq: 1400, gain: g, decay: 0.08 });
    },
    dryFire() { tone({ freq: 1400, duration: 0.03, type: 'square', gain: 0.12 }); },
    reload() {
      tone({ freq: 900, duration: 0.04, type: 'square', gain: 0.15 });
      tone({ freq: 600, duration: 0.04, type: 'square', gain: 0.15, when: 0.22 });
      tone({ freq: 1100, duration: 0.05, type: 'square', gain: 0.2, when: 0.55 });
    },
    hit() { tone({ freq: 1900, duration: 0.05, type: 'sine', gain: 0.3 }); },
    headshot() { tone({ freq: 2400, duration: 0.06, type: 'sine', gain: 0.35 }); tone({ freq: 1900, duration: 0.06, type: 'sine', gain: 0.25, when: 0.05 }); },
    hurt() { tone({ freq: 220, freqEnd: 90, duration: 0.18, type: 'sawtooth', gain: 0.3 }); },
    kill() { tone({ freq: 520, duration: 0.09, type: 'triangle', gain: 0.3 }); tone({ freq: 780, duration: 0.12, type: 'triangle', gain: 0.3, when: 0.08 }); },
    plantBeep(final) { tone({ freq: final ? 1500 : 1000, duration: 0.07, type: 'square', gain: 0.2 }); },
    explosion() {
      burst({ duration: 0.7, filterFreq: 500, gain: 1.0, decay: 0.6 });
      tone({ freq: 90, freqEnd: 28, duration: 0.6, type: 'sine', gain: 0.7 });
    },
    roundWin() {
      tone({ freq: 523, duration: 0.14, type: 'triangle', gain: 0.3 });
      tone({ freq: 659, duration: 0.14, type: 'triangle', gain: 0.3, when: 0.13 });
      tone({ freq: 784, duration: 0.26, type: 'triangle', gain: 0.32, when: 0.26 });
    },
    roundLose() {
      tone({ freq: 392, duration: 0.16, type: 'triangle', gain: 0.3 });
      tone({ freq: 311, duration: 0.3, type: 'triangle', gain: 0.3, when: 0.15 });
    },
    buy() { tone({ freq: 880, duration: 0.06, type: 'sine', gain: 0.25 }); tone({ freq: 1320, duration: 0.08, type: 'sine', gain: 0.2, when: 0.06 }); },
  };
}
