export const DEMO_SAMPLE_RATE = 44100
export const DEMO_BPM = 108
export const DEMO_BARS = 4

const BEAT = 60 / DEMO_BPM
const BEATS = DEMO_BARS * 4
export const DEMO_SECONDS = BEATS * BEAT

export type DemoStem = {
  name: string
  volume: number
  wav: ArrayBuffer
}

type Note = { beat: number; length: number; freq: number; gain: number }

export function renderDemo(): DemoStem[] {
  return [
    { name: 'Drums', volume: 0.82, wav: encodeWav(renderDrums()) },
    { name: 'Bass', volume: 0.72, wav: encodeWav(renderBass()) },
    { name: 'Keys', volume: 0.58, wav: encodeWav(renderKeys()) },
    { name: 'Lead', volume: 0.5, wav: encodeWav(renderLead()) },
  ]
}

function renderDrums(): Float32Array {
  const out = silence()
  for (let bar = 0; bar < DEMO_BARS; bar += 1) {
    const origin = bar * 4
    addKick(out, origin)
    addKick(out, origin + 2)
    addSnare(out, origin + 1)
    addSnare(out, origin + 3)
    for (let step = 0; step < 8; step += 1) addHat(out, origin + step * 0.5, step % 2 === 0 ? 0.16 : 0.08)
  }
  addKick(out, BEATS - 0.5)
  return out
}

function renderBass(): Float32Array {
  const out = silence()
  const loop: Note[] = [
    { beat: 0, length: 0.85, freq: 110, gain: 0.55 },
    { beat: 1.5, length: 0.4, freq: 130.81, gain: 0.42 },
    { beat: 2, length: 0.7, freq: 110, gain: 0.5 },
    { beat: 3, length: 0.8, freq: 82.41, gain: 0.55 },
    { beat: 4, length: 0.85, freq: 110, gain: 0.55 },
    { beat: 5.5, length: 0.4, freq: 98, gain: 0.42 },
    { beat: 6, length: 0.7, freq: 87.31, gain: 0.48 },
    { beat: 7, length: 0.85, freq: 82.41, gain: 0.55 },
  ]
  for (let bar = 0; bar < DEMO_BARS; bar += 2) {
    for (const note of loop) addTone(out, note.beat + bar * 4, note.length, note.freq, note.gain, 'tri')
  }
  return out
}

function renderKeys(): Float32Array {
  const out = silence()
  const chords = [
    [220, 261.63, 329.63],
    [220, 261.63, 329.63],
    [174.61, 220, 261.63],
    [164.81, 207.65, 246.94],
  ]
  chords.forEach((chord, bar) => {
    for (const freq of chord) addTone(out, bar * 4, 1.7, freq, 0.16, 'tri')
    for (const freq of chord) addTone(out, bar * 4 + 2, 1.4, freq, 0.1, 'sine')
  })
  return out
}

function renderLead(): Float32Array {
  const out = silence()
  const line: Note[] = [
    { beat: 0, length: 0.7, freq: 440, gain: 0.34 },
    { beat: 1, length: 0.45, freq: 523.25, gain: 0.3 },
    { beat: 1.5, length: 0.4, freq: 659.25, gain: 0.28 },
    { beat: 2, length: 0.4, freq: 587.33, gain: 0.26 },
    { beat: 2.5, length: 0.9, freq: 523.25, gain: 0.3 },
    { beat: 4, length: 0.7, freq: 440, gain: 0.32 },
    { beat: 5, length: 0.45, freq: 392, gain: 0.26 },
    { beat: 5.5, length: 0.4, freq: 440, gain: 0.26 },
    { beat: 6, length: 1.5, freq: 329.63, gain: 0.3 },
    { beat: 8, length: 0.45, freq: 440, gain: 0.3 },
    { beat: 8.5, length: 0.4, freq: 523.25, gain: 0.28 },
    { beat: 9, length: 0.45, freq: 659.25, gain: 0.28 },
    { beat: 9.5, length: 1.2, freq: 783.99, gain: 0.24 },
    { beat: 11, length: 0.7, freq: 659.25, gain: 0.26 },
    { beat: 12, length: 0.45, freq: 587.33, gain: 0.26 },
    { beat: 12.5, length: 0.4, freq: 523.25, gain: 0.26 },
    { beat: 13, length: 0.7, freq: 440, gain: 0.28 },
    { beat: 14, length: 1.6, freq: 329.63, gain: 0.3 },
  ]
  for (const note of line) addTone(out, note.beat, note.length, note.freq, note.gain, 'sine')
  return out
}

function silence(): Float32Array {
  return new Float32Array(Math.round(DEMO_SECONDS * DEMO_SAMPLE_RATE))
}

function addKick(out: Float32Array, beat: number) {
  const start = at(beat)
  const length = Math.floor(0.22 * DEMO_SAMPLE_RATE)
  let phase = 0
  for (let index = 0; index < length && start + index < out.length; index += 1) {
    const t = index / DEMO_SAMPLE_RATE
    const freq = 46 + 130 * Math.exp(-t * 28)
    phase += (2 * Math.PI * freq) / DEMO_SAMPLE_RATE
    const body = Math.sin(phase) * Math.exp(-t * 9)
    const click = noise(index + Math.floor(beat * 10)) * Math.exp(-t * 70) * 0.35
    out[start + index] += (body + click) * 0.9
  }
}

function addSnare(out: Float32Array, beat: number) {
  const start = at(beat)
  const length = Math.floor(0.16 * DEMO_SAMPLE_RATE)
  for (let index = 0; index < length && start + index < out.length; index += 1) {
    const t = index / DEMO_SAMPLE_RATE
    const body = Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t * 22) * 0.35
    const rattle = (noise(index + 80) - noise(index + 79)) * Math.exp(-t * 16) * 0.45
    out[start + index] += body + rattle
  }
}

function addHat(out: Float32Array, beat: number, gain: number) {
  const start = at(beat)
  const length = Math.floor(0.045 * DEMO_SAMPLE_RATE)
  for (let index = 0; index < length && start + index < out.length; index += 1) {
    const t = index / DEMO_SAMPLE_RATE
    const bright = noise(index + Math.floor(beat * 50) + 400) - noise(index + Math.floor(beat * 50) + 399)
    out[start + index] += bright * Math.exp(-t * 55) * gain
  }
}

function addTone(
  out: Float32Array,
  beat: number,
  lengthBeats: number,
  freq: number,
  gain: number,
  shape: 'sine' | 'tri',
) {
  const start = at(beat)
  const length = Math.max(1, Math.floor(lengthBeats * BEAT * DEMO_SAMPLE_RATE))
  const attack = Math.min(0.02, (length / DEMO_SAMPLE_RATE) * 0.25)
  const release = Math.min(0.09, (length / DEMO_SAMPLE_RATE) * 0.4)
  for (let index = 0; index < length && start + index < out.length; index += 1) {
    const t = index / DEMO_SAMPLE_RATE
    out[start + index] += gain * envelope(t, attack, release, length / DEMO_SAMPLE_RATE) * wave(shape, freq, t)
  }
}

function envelope(t: number, attack: number, release: number, duration: number): number {
  if (t < attack) return attack === 0 ? 1 : t / attack
  const releaseAt = Math.max(attack, duration - release)
  if (t < releaseAt) return 1
  if (t >= duration) return 0
  return 1 - (t - releaseAt) / Math.max(release, 0.0001)
}

function wave(shape: 'sine' | 'tri', freq: number, t: number): number {
  if (shape === 'sine') return Math.sin(2 * Math.PI * freq * t)
  const phase = (t * freq) % 1
  return 4 * Math.abs(phase - 0.5) - 1
}

function noise(index: number): number {
  const value = Math.sin(index * 12.9898) * 43758.5453
  return (value - Math.floor(value)) * 2 - 1
}

function at(beat: number): number {
  return Math.max(0, Math.round(beat * BEAT * DEMO_SAMPLE_RATE))
}

function encodeWav(samples: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  write(view, 0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  write(view, 8, 'WAVE')
  write(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, DEMO_SAMPLE_RATE, true)
  view.setUint32(28, DEMO_SAMPLE_RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  write(view, 36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]))
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
  }
  return buffer
}

function write(view: DataView, offset: number, text: string) {
  for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index))
}
