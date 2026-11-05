export const MAX_AUDIO_BYTES = 30 * 1024 * 1024
export const CHUNK_BYTES = 16 * 1024

export type ControlMessage =
  | { t: 'ping'; id: string; t0: number }
  | { t: 'pong'; id: string; t0: number; t1: number }
  | {
      t: 'transport'
      action: 'play' | 'stop' | 'seek'
      positionSec: number
      sharedTimeMs?: number
      issuedAt: number
      clientId: string
    }
  | { t: 'asset-request'; sha256: string }
  | { t: 'asset-begin'; sha256: string; byteLength: number }
  | { t: 'asset-chunk'; sha256: string; offset: number; data: Uint8Array }
  | { t: 'asset-end'; sha256: string }

const JSON_TYPE = 1
const CHUNK_TYPE = 2

export function encodeControl(msg: ControlMessage): Uint8Array {
  if (msg.t === 'asset-chunk') {
    const sha = new TextEncoder().encode(msg.sha256)
    const out = new Uint8Array(2 + sha.length + 4 + msg.data.byteLength)
    const view = new DataView(out.buffer)
    out[0] = CHUNK_TYPE
    out[1] = sha.length
    out.set(sha, 2)
    view.setUint32(2 + sha.length, msg.offset)
    out.set(msg.data, 6 + sha.length)
    return out
  }
  const json = new TextEncoder().encode(JSON.stringify(msg))
  const out = new Uint8Array(1 + json.length)
  out[0] = JSON_TYPE
  out.set(json, 1)
  return out
}

const MAX_CONTROL_JSON = 4096

export function decodeControl(buf: ArrayBuffer): ControlMessage {
  if (buf.byteLength > CHUNK_BYTES + 128) throw new Error('Control message too large')
  const bytes = new Uint8Array(buf)
  if (bytes.length < 2) throw new Error('Short control message')
  if (bytes[0] === CHUNK_TYPE) {
    const shaLen = bytes[1]
    const header = 2 + shaLen + 4
    if (shaLen !== 64 || bytes.length < header || bytes.length - header > CHUNK_BYTES) {
      throw new Error('Bad asset chunk')
    }
    const sha256 = new TextDecoder().decode(bytes.subarray(2, 2 + shaLen))
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('Bad asset chunk')
    const offset = new DataView(buf).getUint32(2 + shaLen)
    if (offset > MAX_AUDIO_BYTES) throw new Error('Bad asset chunk')
    const data = bytes.subarray(header).slice()
    return { t: 'asset-chunk', sha256, offset, data }
  }
  if (bytes[0] !== JSON_TYPE || bytes.length > MAX_CONTROL_JSON) throw new Error('Unknown control message')
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes.subarray(1)))
  const message = checkedControl(parsed)
  if (!message) throw new Error('Bad control message')
  return message
}

function checkedControl(value: unknown): ControlMessage | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (record.t === 'ping' || record.t === 'pong') {
    if (typeof record.id !== 'string' || record.id.length === 0 || record.id.length > 80) return null
    if (!finite(record.t0)) return null
    if (record.t === 'pong' && !finite(record.t1)) return null
    return record.t === 'ping'
      ? { t: 'ping', id: record.id, t0: record.t0 }
      : { t: 'pong', id: record.id, t0: record.t0 as number, t1: record.t1 as number }
  }
  if (record.t === 'transport') {
    if (record.action !== 'play' && record.action !== 'stop' && record.action !== 'seek') return null
    if (!finite(record.positionSec) || record.positionSec < 0 || record.positionSec > 6 * 60 * 60) return null
    if (!finite(record.issuedAt)) return null
    if (typeof record.clientId !== 'string' || record.clientId.length > 80) return null
    if (record.sharedTimeMs != null && !finite(record.sharedTimeMs)) return null
    return {
      t: 'transport',
      action: record.action,
      positionSec: record.positionSec,
      sharedTimeMs: typeof record.sharedTimeMs === 'number' ? record.sharedTimeMs : undefined,
      issuedAt: record.issuedAt,
      clientId: record.clientId,
    }
  }
  if (!isSha(record.sha256)) return null
  if (record.t === 'asset-request' || record.t === 'asset-end') return { t: record.t, sha256: record.sha256 }
  if (record.t === 'asset-begin') {
    if (typeof record.byteLength !== 'number' || !Number.isInteger(record.byteLength)) return null
    if (record.byteLength < 1 || record.byteLength > MAX_AUDIO_BYTES) return null
    return { t: 'asset-begin', sha256: record.sha256, byteLength: record.byteLength }
  }
  return null
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isSha(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

export function controlPriority(msg: ControlMessage): number {
  return msg.t === 'asset-chunk' || msg.t === 'asset-begin' || msg.t === 'asset-end' ? 1 : 0
}
