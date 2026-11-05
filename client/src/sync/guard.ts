import type { AssetMeta, Clip, Track } from './doc'
import { MAX_AUDIO_BYTES } from './control'

export const MAX_TRACKS = 32
export const MAX_CLIPS = 400
export const MAX_ASSETS = 200
export const MAX_LABEL = 40
const MAX_SECONDS = 6 * 60 * 60

const CONTROL_CHARS = /[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g

export function cleanLabel(value: unknown, fallback: string, max = MAX_LABEL): string {
  if (typeof value !== 'string') return fallback
  const cleaned = value.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
  return cleaned || fallback
}

export function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

export function isSafeId(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 80) return false
  return value.replace(CONTROL_CHARS, '') === value
}

export function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

export function sanitizeTrack(value: unknown): Track | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (!isSafeId(record.id)) return null
  return {
    id: record.id,
    name: cleanLabel(record.name, 'Track'),
    volume: clampNumber(record.volume, 0, 1, 0.8),
    mute: record.mute === true,
  }
}

export function sanitizeClip(value: unknown): Clip | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (!isSafeId(record.id) || !isSafeId(record.trackId) || !isSafeId(record.assetId)) return null
  if (typeof record.durationSec !== 'number' || !Number.isFinite(record.durationSec) || record.durationSec < 0.05) {
    return null
  }
  const durationSec = Math.min(MAX_SECONDS, record.durationSec)
  return {
    id: record.id,
    trackId: record.trackId,
    assetId: record.assetId,
    startSec: clampNumber(record.startSec, 0, MAX_SECONDS, 0),
    offsetSec: clampNumber(record.offsetSec, 0, MAX_SECONDS, 0),
    durationSec,
  }
}

export function sanitizeAsset(value: unknown): AssetMeta | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (!isSafeId(record.id) || !isSha256(record.sha256)) return null
  if (typeof record.byteLength !== 'number' || !Number.isInteger(record.byteLength)) return null
  if (record.byteLength < 1 || record.byteLength > MAX_AUDIO_BYTES) return null
  if (typeof record.durationSec !== 'number' || !Number.isFinite(record.durationSec) || record.durationSec < 0.05) {
    return null
  }
  const durationSec = Math.min(MAX_SECONDS, record.durationSec)
  const mime = typeof record.mime === 'string' ? record.mime.slice(0, 80) : 'application/octet-stream'
  return {
    id: record.id,
    name: cleanLabel(record.name, 'Audio'),
    durationSec,
    mime,
    byteLength: record.byteLength,
    sha256: record.sha256,
  }
}
