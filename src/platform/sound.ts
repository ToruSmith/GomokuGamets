/** 所有音效都即時合成，不需要載入音檔。 */
let context: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    context ??= new AudioContext();
    if (context.state === 'suspended') void context.resume();
    return context;
  } catch {
    return null;
  }
}

/** 棋子落在木盤上：短促的噪音叩擊加一個低頻共鳴 */
export function playStone(): void {
  const ctx = audio();
  if (!ctx) return;
  const start = ctx.currentTime;
  const length = Math.floor(ctx.sampleRate * 0.05);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) samples[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 2100;
  filter.Q.value = 1.1;
  const click = ctx.createGain();
  click.gain.value = 0.5;
  noise.connect(filter).connect(click).connect(ctx.destination);
  noise.start(start);

  const body = ctx.createOscillator();
  body.frequency.setValueAtTime(240, start);
  body.frequency.exponentialRampToValueAtTime(130, start + 0.08);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.24, start);
  gain.gain.exponentialRampToValueAtTime(0.001, start + 0.1);
  body.connect(gain).connect(ctx.destination);
  body.start(start);
  body.stop(start + 0.11);
}

function pluck(frequency: number, at: number, volume: number): void {
  const ctx = audio();
  if (!ctx) return;
  const start = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = frequency;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.001, start + 0.9);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + 0.95);
}

export function playWin(): void {
  [392, 523.25, 659.25].forEach((note, i) => pluck(note, i * 0.13, 0.13));
}

export function playLose(): void {
  [329.63, 261.63].forEach((note, i) => pluck(note, i * 0.2, 0.1));
}

export function playNudge(): void {
  pluck(880, 0, 0.05);
}
