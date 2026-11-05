import assert from 'node:assert/strict'
import test from 'node:test'
import { CHUNK_BYTES, decodeControl, encodeControl } from './control.ts'

test('control messages round-trip and reject oversized or unknown payloads', () => {
  const ping = encodeControl({ t: 'ping', id: 'abc', t0: 12.5 })
  assert.deepEqual(decodeControl(ping.buffer.slice(ping.byteOffset, ping.byteOffset + ping.byteLength)), {
    t: 'ping',
    id: 'abc',
    t0: 12.5,
  })

  const sha = 'ab'.repeat(32)
  const chunk = encodeControl({ t: 'asset-chunk', sha256: sha, offset: 32, data: new Uint8Array([1, 2, 3]) })
  const decoded = decodeControl(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength))
  assert.equal(decoded.t, 'asset-chunk')
  if (decoded.t === 'asset-chunk') {
    assert.equal(decoded.sha256, sha)
    assert.equal(decoded.offset, 32)
    assert.deepEqual([...decoded.data], [1, 2, 3])
  }

  const huge = new Uint8Array(CHUNK_BYTES + 200)
  huge[0] = 1
  assert.throws(() => decodeControl(huge.buffer))
  assert.throws(() => decodeControl(encodeControl({ t: 'ping', id: 'x'.repeat(200), t0: 1 }).buffer))
})
