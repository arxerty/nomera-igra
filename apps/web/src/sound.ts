/** Звуки без файлов — генерируются WebAudio. */
let ctx: AudioContext | null = null;
let enabled = true;

export function setSoundEnabled(v: boolean) {
  enabled = v;
}

function audio(): AudioContext | null {
  if (!enabled) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, start: number, duration: number, type: OscillatorType = 'square', volume = 0.06) {
  const a = audio();
  if (!a) return;
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const t = a.currentTime + start;
  gain.gain.setValueAtTime(volume, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(gain).connect(a.destination);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

export const sound = {
  /** Щелчок при остановке барабана. */
  tick(i = 0) {
    tone(520 + i * 40, 0, 0.06, 'square', 0.05);
  },
  /** Обычный результат. */
  reveal() {
    tone(660, 0, 0.12, 'triangle', 0.08);
    tone(880, 0.1, 0.16, 'triangle', 0.08);
  },
  /** Эпик и выше — фанфары. */
  fanfare() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.3, 'sawtooth', 0.05));
    tone(1319, 0.48, 0.6, 'triangle', 0.07);
  },
  coin() {
    tone(988, 0, 0.08, 'square', 0.05);
    tone(1319, 0.07, 0.18, 'square', 0.05);
  },
};
