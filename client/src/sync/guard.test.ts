import assert from 'node:assert/strict'
import test from 'node:test'
import { cleanLabel, sanitizeAsset, sanitizeClip, sanitizeTrack } from './guard.ts'

test('labels drop control characters and keep a fallback', () => {
  assert.equal(cleanLabel('  Drums\u202E  ', 'Track'), 'Drums')
  assert.equal(cleanLabel('   ', 'Track'), 'Track')
  assert.equal(cleanLabel(null, 'Track'), 'Track')
})

test('tracks, clips, and assets reject shapes a peer should not be able to inject', () => {
  assert.equal(sanitizeTrack({ id: 'track-1', name: 'Drums', volume: 4, mute: 'yes' })?.volume, 1)
  assert.equal(sanitizeTrack({ id: 'bad\nname', name: 'Drums', volume: 0.5, mute: false }), null)
  assert.equal(sanitizeClip({ id: 'c', trackId: 't', assetId: 'a', startSec: -4, offsetSec: 0, durationSec: 0 }), null)
  assert.equal(
    sanitizeClip({ id: 'c', trackId: 't', assetId: 'a', startSec: -4, offsetSec: 0, durationSec: 1 })?.startSec,
    0,
  )
  const sha = 'a'.repeat(64)
  assert.equal(sanitizeAsset({ id: 'a', name: 'tone.wav', durationSec: 1, mime: 'audio/wav', byteLength: 12, sha256: sha })?.name, 'tone.wav')
  assert.equal(
    sanitizeAsset({ id: 'a', name: 'tone.wav', durationSec: 1, mime: 'audio/wav', byteLength: 40 * 1024 * 1024, sha256: sha }),
    null,
  )
  assert.equal(
    sanitizeAsset({ id: 'a', name: 'tone.wav', durationSec: 1, mime: 'audio/wav', byteLength: 12, sha256: 'not-a-hash' }),
    null,
  )
})
