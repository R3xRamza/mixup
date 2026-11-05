import assert from 'node:assert/strict'
import test from 'node:test'
import { DEMO_SAMPLE_RATE, DEMO_SECONDS, renderDemo } from './demo.ts'

test('demo loop is four audible wav stems of the same length', () => {
  const stems = renderDemo()
  assert.deepEqual(
    stems.map((stem) => stem.name),
    ['Drums', 'Bass', 'Keys', 'Lead'],
  )
  for (const stem of stems) {
    const bytes = new Uint8Array(stem.wav)
    assert.equal(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]), 'RIFF')
    const samples = pcm(stem.wav)
    const expected = Math.round(DEMO_SECONDS * DEMO_SAMPLE_RATE)
    assert.equal(samples.length, expected)
    assert.ok(energy(samples, 0, 0.08) > 0.0004, `${stem.name} starts silent`)
  }
  const drums = pcm(stems[0].wav)
  assert.ok(energy(drums, 0, 0.04) > energy(drums, 0.28, 0.04) * 2)
})

function pcm(wav: ArrayBuffer): Float32Array {
  const view = new DataView(wav)
  const count = (wav.byteLength - 44) / 2
  const samples = new Float32Array(count)
  for (let index = 0; index < count; index += 1) {
    samples[index] = view.getInt16(44 + index * 2, true) / 0x8000
  }
  return samples
}

function energy(samples: Float32Array, startSec: number, durationSec: number): number {
  const start = Math.floor(startSec * DEMO_SAMPLE_RATE)
  const count = Math.floor(durationSec * DEMO_SAMPLE_RATE)
  let sum = 0
  for (let index = 0; index < count; index += 1) {
    const sample = samples[start + index] ?? 0
    sum += sample * sample
  }
  return sum / count
}
