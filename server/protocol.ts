export const LIMITS = {
  maxPeers: 4,
  maxRooms: 500,
  maxConnectionsPerIp: 20,
  maxMessageBytes: 64 * 1024,
  maxMessagesPer10s: 80,
  maxName: 32,
  maxSdpChars: 50_000,
  maxIceChars: 2_000,
  violationsBeforeClose: 5,
} as const

const ROOM_CODE = /^[a-z0-9-]{4,32}$/
const CLIENT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CONTROL_CHARS = /[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g

export type SignalPayload =
  | { kind: 'offer'; sdp: SessionDescription }
  | { kind: 'answer'; sdp: SessionDescription }
  | { kind: 'ice'; candidate: IceCandidate }
  | { kind: 'please-offer' }
  | { kind: 'restart' }

type SessionDescription = { type: 'offer' | 'answer'; sdp: string }
type IceCandidate = {
  candidate: string
  sdpMid: string | null
  sdpMLineIndex: number | null
  usernameFragment?: string
}

export type ClientMessage =
  | { type: 'join'; roomId: string; clientId: string; name: string }
  | { type: 'signal'; to: string; payload: SignalPayload }

export function sanitizeName(input: unknown): string {
  const raw = typeof input === 'string' ? input : ''
  const cleaned = raw.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim().slice(0, LIMITS.maxName)
  return cleaned || 'Guest'
}

export function originAllowed(origin: string | undefined, allowed: readonly string[] | null): boolean {
  if (!allowed) return true
  if (!origin) return false
  return allowed.includes(origin)
}

export function parseAllowedOrigins(raw: string | undefined): string[] | null {
  if (!raw?.trim()) return null
  const list = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  return list.length > 0 ? list : null
}

export function parseClientMessage(raw: string): { ok: true; message: ClientMessage } | { ok: false; error: string } {
  if (raw.length > LIMITS.maxMessageBytes) return { ok: false, error: 'Message is too large.' }
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return { ok: false, error: 'Message must be JSON.' }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'Message must be an object.' }
  }
  const record = value as Record<string, unknown>
  if (record.type === 'join') return parseJoin(record)
  if (record.type === 'signal') return parseSignal(record)
  return { ok: false, error: 'Unknown message type.' }
}

function parseJoin(record: Record<string, unknown>): { ok: true; message: ClientMessage } | { ok: false; error: string } {
  const roomId = typeof record.roomId === 'string' ? record.roomId.trim().toLowerCase() : ''
  const clientId = typeof record.clientId === 'string' ? record.clientId.trim() : ''
  if (!ROOM_CODE.test(roomId)) return { ok: false, error: 'Room codes are 4–32 letters, numbers, or dashes.' }
  if (!CLIENT_ID.test(clientId)) return { ok: false, error: 'Client id is not valid.' }
  return { ok: true, message: { type: 'join', roomId, clientId, name: sanitizeName(record.name) } }
}

function parseSignal(record: Record<string, unknown>): { ok: true; message: ClientMessage } | { ok: false; error: string } {
  const to = typeof record.to === 'string' ? record.to.trim() : ''
  if (!CLIENT_ID.test(to)) return { ok: false, error: 'Signal target is not valid.' }
  const payload = sanitizePayload(record.payload)
  if (!payload) return { ok: false, error: 'Signal payload is not valid.' }
  return { ok: true, message: { type: 'signal', to, payload } }
}

function sanitizePayload(value: unknown): SignalPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (record.kind === 'please-offer' || record.kind === 'restart') return { kind: record.kind }
  if (record.kind === 'offer' || record.kind === 'answer') {
    const sdp = description(record.sdp, record.kind)
    return sdp ? { kind: record.kind, sdp } : null
  }
  if (record.kind === 'ice') {
    const candidate = ice(record.candidate)
    return candidate ? { kind: 'ice', candidate } : null
  }
  return null
}

function description(value: unknown, kind: 'offer' | 'answer'): SessionDescription | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (record.type !== kind || typeof record.sdp !== 'string') return null
  if (record.sdp.length === 0 || record.sdp.length > LIMITS.maxSdpChars) return null
  return { type: kind, sdp: record.sdp }
}

function ice(value: unknown): IceCandidate | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (typeof record.candidate !== 'string' || record.candidate.length > LIMITS.maxIceChars) return null
  const sdpMid = record.sdpMid === null || typeof record.sdpMid === 'string' ? (record.sdpMid as string | null) : null
  if (typeof sdpMid === 'string' && sdpMid.length > 32) return null
  const line = record.sdpMLineIndex
  const sdpMLineIndex = line === null || (typeof line === 'number' && Number.isInteger(line) && line >= 0 && line < 64)
    ? (line as number | null)
    : null
  const usernameFragment = typeof record.usernameFragment === 'string' ? record.usernameFragment.slice(0, 256) : undefined
  return { candidate: record.candidate, sdpMid, sdpMLineIndex, usernameFragment }
}

export class MessageBudget {
  private stamps: number[] = []

  constructor(private readonly limit = LIMITS.maxMessagesPer10s, private readonly windowMs = 10_000) {}

  allow(now: number): boolean {
    this.stamps = this.stamps.filter((stamp) => now - stamp < this.windowMs)
    if (this.stamps.length >= this.limit) return false
    this.stamps.push(now)
    return true
  }
}
