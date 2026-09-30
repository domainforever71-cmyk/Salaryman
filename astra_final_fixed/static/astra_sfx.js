/* ASTRA :: retro sound engine
 *
 * Every sound is synthesised at runtime with WebAudio. There are no .wav or
 * .mp3 files to host, nothing to download, and nothing to go 404 - which also
 * means the whole thing weighs a few KB instead of a few MB.
 *
 * Browsers refuse to start audio until the user has interacted with the page,
 * so the AudioContext is created lazily on the first real gesture and every
 * play() before that point is a silent no-op rather than a console error.
 *
 * Public API:
 *   SFX.play(name)          fire a one-shot effect
 *   SFX.setEnabled(bool)    mute / unmute (persisted by the caller)
 *   SFX.enabled             current state
 *   Chiptune.play(spec)     start a generated loop  {genre,bpm,key,bars,seed}
 *   Chiptune.stop()
 *   Chiptune.isPlaying()
 */
(function (global) {
  'use strict';

  var ctx = null;
  var master = null;
  var enabled = true;
  var unlocked = false;

  function ensureContext() {
    if (ctx) return ctx;
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
    return ctx;
  }

  // The first genuine gesture unlocks audio. Passive listeners so we never
  // interfere with scrolling or the terminal's own click handlers.
  function unlock() {
    unlocked = true;
    var c = ensureContext();
    if (c && c.state === 'suspended') c.resume();
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach(function (evt) {
    global.addEventListener(evt, unlock, { once: true, passive: true });
  });

  function now() { return ctx.currentTime; }

  /* ---------------------------------------------------------------
   * Primitives
   * ------------------------------------------------------------- */

  // A single oscillator with an envelope. `slide` bends the pitch, which is
  // what makes something read as "retro" rather than as a beep.
  function tone(opts) {
    var c = ensureContext();
    if (!c) return;
    var t0 = now();
    var osc = c.createOscillator();
    var gain = c.createGain();

    osc.type = opts.type || 'square';
    osc.frequency.setValueAtTime(opts.freq, t0);
    if (opts.slide) {
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(20, opts.slide), t0 + (opts.dur || 0.1)
      );
    }

    var peak = opts.gain == null ? 0.3 : opts.gain;
    var dur = opts.dur || 0.1;
    var attack = opts.attack == null ? 0.005 : opts.attack;

    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(gain);
    gain.connect(opts.dest || master);
    osc.start(t0 + (opts.delay || 0));
    osc.stop(t0 + dur + 0.02 + (opts.delay || 0));
  }

  // Filtered white noise - used for static, key clicks and the alert buzz.
  function noise(opts) {
    var c = ensureContext();
    if (!c) return;
    var dur = opts.dur || 0.08;
    var frames = Math.max(1, Math.floor(c.sampleRate * dur));
    var buffer = c.createBuffer(1, frames, c.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;

    var src = c.createBufferSource();
    src.buffer = buffer;

    var filter = c.createBiquadFilter();
    filter.type = opts.filterType || 'bandpass';
    filter.frequency.value = opts.freq || 1400;
    filter.Q.value = opts.q || 1.2;

    var gain = c.createGain();
    var t0 = now();
    var peak = opts.gain == null ? 0.18 : opts.gain;
    gain.gain.setValueAtTime(peak, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start(t0);
  }

  /* ---------------------------------------------------------------
   * The effect set
   * ------------------------------------------------------------- */

  var EFFECTS = {
    // UI
    click:   function () { tone({ freq: 880, slide: 660, dur: 0.05, gain: 0.16, type: 'square' }); },
    hover:   function () { tone({ freq: 1200, dur: 0.025, gain: 0.05, type: 'sine' }); },
    type:    function () { noise({ freq: 2200, dur: 0.02, gain: 0.07, q: 3 }); },
    open:    function () {
      tone({ freq: 420, slide: 900, dur: 0.14, gain: 0.16, type: 'square' });
      tone({ freq: 630, slide: 1320, dur: 0.14, gain: 0.08, type: 'triangle', delay: 0.03 });
    },
    close:   function () { tone({ freq: 900, slide: 300, dur: 0.13, gain: 0.15, type: 'square' }); },
    tab:     function () { tone({ freq: 700, slide: 1050, dur: 0.06, gain: 0.12, type: 'square' }); },

    // Outcomes
    confirm: function () {
      tone({ freq: 660, dur: 0.09, gain: 0.2, type: 'square' });
      tone({ freq: 990, dur: 0.14, gain: 0.18, type: 'square', delay: 0.08 });
    },
    deny:    function () {
      tone({ freq: 240, slide: 110, dur: 0.22, gain: 0.22, type: 'sawtooth' });
      noise({ freq: 320, dur: 0.16, gain: 0.1 });
    },
    alert:   function () {
      tone({ freq: 880, dur: 0.1, gain: 0.2, type: 'square' });
      tone({ freq: 880, dur: 0.1, gain: 0.2, type: 'square', delay: 0.16 });
      tone({ freq: 880, dur: 0.1, gain: 0.2, type: 'square', delay: 0.32 });
    },

    // Trading floor
    buy:     function () {
      tone({ freq: 520, slide: 1040, dur: 0.16, gain: 0.2, type: 'square' });
      tone({ freq: 780, dur: 0.1, gain: 0.1, type: 'triangle', delay: 0.1 });
    },
    sell:    function () {
      tone({ freq: 1040, slide: 480, dur: 0.16, gain: 0.2, type: 'square' });
      tone({ freq: 360, dur: 0.1, gain: 0.1, type: 'triangle', delay: 0.1 });
    },
    cash:    function () {
      [1046, 1318, 1568, 2093].forEach(function (f, i) {
        tone({ freq: f, dur: 0.16, gain: 0.14, type: 'square', delay: i * 0.055 });
      });
    },
    dial:    function () {
      // A rough DTMF-ish pair, then the line picking up.
      tone({ freq: 697, dur: 0.1, gain: 0.12, type: 'sine' });
      tone({ freq: 1209, dur: 0.1, gain: 0.12, type: 'sine' });
      tone({ freq: 440, dur: 0.18, gain: 0.1, type: 'sine', delay: 0.22 });
    },
    day:     function () {
      tone({ freq: 330, slide: 495, dur: 0.2, gain: 0.16, type: 'triangle' });
      noise({ freq: 900, dur: 0.12, gain: 0.06 });
    },

    // System
    boot:    function () {
      [220, 330, 440, 660, 880].forEach(function (f, i) {
        tone({ freq: f, dur: 0.18, gain: 0.13, type: 'square', delay: i * 0.09 });
      });
      noise({ freq: 600, dur: 0.4, gain: 0.05, filterType: 'lowpass' });
    },
    error:   function () {
      tone({ freq: 160, dur: 0.3, gain: 0.24, type: 'sawtooth' });
      tone({ freq: 163, dur: 0.3, gain: 0.24, type: 'sawtooth' });
    },
    unlock:  function () {
      [523, 659, 784, 1046, 1318].forEach(function (f, i) {
        tone({ freq: f, dur: 0.22, gain: 0.15, type: 'triangle', delay: i * 0.07 });
      });
    },

    // Phase 8 additions - the incoming-call overlay, bank, hiring, casino
    // and politics views all reference these by name; they didn't exist
    // yet, so those calls were silent no-ops. Same synth primitives as
    // everything above, no new dependency.
    ring:    function () {
      // Two-tone phone ring, twice, like the old amber comms terminal.
      [0, 0.5].forEach(function (delay) {
        tone({ freq: 480, dur: 0.35, gain: 0.14, type: 'sine', delay: delay });
        tone({ freq: 620, dur: 0.35, gain: 0.14, type: 'sine', delay: delay });
      });
    },
    win:     function () {
      [523, 659, 784, 1046, 1318, 1568].forEach(function (f, i) {
        tone({ freq: f, dur: 0.14, gain: 0.15, type: 'square', delay: i * 0.05 });
      });
    },
    lose:    function () {
      tone({ freq: 220, slide: 110, dur: 0.4, gain: 0.18, type: 'sawtooth' });
    },
    loan:    function () {
      tone({ freq: 330, dur: 0.12, gain: 0.14, type: 'triangle' });
      tone({ freq: 494, dur: 0.16, gain: 0.14, type: 'triangle', delay: 0.08 });
    },
    hire:    function () {
      tone({ freq: 440, dur: 0.1, gain: 0.13, type: 'square' });
      tone({ freq: 660, dur: 0.14, gain: 0.13, type: 'square', delay: 0.07 });
      tone({ freq: 880, dur: 0.18, gain: 0.13, type: 'square', delay: 0.14 });
    },
    news:    function () {
      tone({ freq: 1400, dur: 0.045, gain: 0.09, type: 'sine' });
      tone({ freq: 1400, dur: 0.045, gain: 0.09, type: 'sine', delay: 0.09 });
    }
  };

  var SFX = {
    get enabled() { return enabled; },
    setEnabled: function (v) {
      enabled = !!v;
      if (!enabled) Chiptune.stop();
      return enabled;
    },
    setVolume: function (v) {
      v = Math.max(0, Math.min(1, v == null ? 0.35 : v));
      var c = ensureContext();
      if (master) master.gain.value = v;
      return v;
    },
    play: function (name) {
      if (!enabled || !unlocked) return;
      var fn = EFFECTS[name];
      if (!fn) return;
      try { fn(); } catch (e) { /* audio is never worth breaking the UI over */ }
    },
    list: function () { return Object.keys(EFFECTS); }
  };

  /* ---------------------------------------------------------------
   * Chiptune generator (Music Studio)
   * ------------------------------------------------------------- */

  var NOTE_OFFSET = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  var GENRE_WAVE = {
    synthwave: 'sawtooth', chiptune: 'square', darkwave: 'triangle',
    acidhouse: 'sawtooth', ambient: 'sine'
  };
  var GENRE_SCALE = {
    synthwave: [0, 3, 5, 7, 10], chiptune: [0, 2, 4, 7, 9],
    darkwave: [0, 2, 3, 7, 8], acidhouse: [0, 3, 5, 6, 10],
    ambient: [0, 2, 5, 7, 9]
  };

  // Deterministic PRNG so the same seed always renders the same track - the
  // server stores only the seed, and the browser reconstructs the audio.
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function midiToFreq(n) { return 440 * Math.pow(2, (n - 69) / 12); }

  var chipTimer = null;
  var chipPlaying = false;

  var Chiptune = {
    isPlaying: function () { return chipPlaying; },

    stop: function () {
      if (chipTimer) { clearTimeout(chipTimer); chipTimer = null; }
      chipPlaying = false;
    },

    play: function (spec) {
      spec = spec || {};
      if (!enabled) return false;
      var c = ensureContext();
      if (!c || !unlocked) return false;
      if (c.state === 'suspended') c.resume();

      this.stop();
      chipPlaying = true;

      var genre = spec.genre || 'chiptune';
      var bpm = Math.max(40, Math.min(220, spec.bpm || 120));
      var bars = Math.max(2, Math.min(32, spec.bars || 8));
      var root = 48 + (NOTE_OFFSET[spec.key] == null ? 0 : NOTE_OFFSET[spec.key]);
      var scale = GENRE_SCALE[genre] || GENRE_SCALE.chiptune;
      var wave = GENRE_WAVE[genre] || 'square';
      var rand = mulberry32(spec.seed || 1);

      var stepDur = 60 / bpm / 2;     // eighth notes
      var steps = bars * 8;
      var step = 0;

      function tick() {
        if (!chipPlaying) return;

        var inBar = step % 8;

        // Bass on the downbeats.
        if (inBar === 0 || inBar === 4) {
          tone({ freq: midiToFreq(root - 12), type: 'triangle',
                 dur: stepDur * 1.6, gain: 0.22 });
        }

        // Lead: mostly scale tones, with rests so it breathes.
        if (rand() > 0.22) {
          var degree = scale[Math.floor(rand() * scale.length)];
          var octave = rand() > 0.78 ? 12 : 0;
          tone({ freq: midiToFreq(root + 12 + degree + octave), type: wave,
                 dur: stepDur * 1.5, gain: 0.13 });
        }

        // Percussion: kick on 0/4, hat on odd eighths.
        if (inBar === 0 || inBar === 4) {
          tone({ freq: 140, slide: 50, dur: 0.11, gain: 0.3, type: 'sine' });
        }
        if (inBar % 2 === 1 && genre !== 'ambient') {
          noise({ freq: 7000, dur: 0.03, gain: 0.05, q: 2 });
        }

        step++;
        if (step >= steps) step = 0;   // loop
        chipTimer = setTimeout(tick, stepDur * 1000);
      }

      tick();
      return true;
    }
  };

  global.SFX = SFX;
  global.Chiptune = Chiptune;
})(window);
