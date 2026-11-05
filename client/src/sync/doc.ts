import * as Y from 'yjs'
import {
  MAX_ASSETS,
  MAX_CLIPS,
  MAX_TRACKS,
  clampNumber,
  cleanLabel,
  isSafeId,
  sanitizeAsset,
  sanitizeClip,
  sanitizeTrack,
} from './guard'

export type Track = {
  id: string
  name: string
  volume: number
  mute: boolean
}

export type Clip = {
  id: string
  trackId: string
  assetId: string
  startSec: number
  offsetSec: number
  durationSec: number
}

export type AssetMeta = {
  id: string
  name: string
  durationSec: number
  mime: string
  byteLength: number
  sha256: string
}

export type TransportState = {
  status: 'playing' | 'stopped'
  positionSec: number
  issuedAt: number
  clientId: string
  sharedTimeMs?: number
}

export function tracksOf(doc: Y.Doc): Y.Array<Track> {
  return doc.getArray('tracks') as unknown as Y.Array<Track>
}

export function clipsOf(doc: Y.Doc): Y.Map<Clip> {
  return doc.getMap('clips') as unknown as Y.Map<Clip>
}

export function assetsOf(doc: Y.Doc): Y.Map<AssetMeta> {
  return doc.getMap('assets') as unknown as Y.Map<AssetMeta>
}

export function transportOf(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap('transport')
}

const MAX_SECONDS = 6 * 60 * 60

export function readTracks(doc: Y.Doc): Track[] {
  const tracks: Track[] = []
  for (const value of tracksOf(doc).toArray()) {
    const track = sanitizeTrack(value)
    if (track) tracks.push(track)
    if (tracks.length >= MAX_TRACKS) break
  }
  return tracks
}

export function readClips(doc: Y.Doc): Clip[] {
  const clips: Clip[] = []
  clipsOf(doc).forEach((value) => {
    if (clips.length >= MAX_CLIPS) return
    const clip = sanitizeClip(value)
    if (clip) clips.push(clip)
  })
  return clips
}

export function readAssets(doc: Y.Doc): AssetMeta[] {
  const assets: AssetMeta[] = []
  assetsOf(doc).forEach((value) => {
    if (assets.length >= MAX_ASSETS) return
    const asset = sanitizeAsset(value)
    if (asset) assets.push(asset)
  })
  return assets
}

export function readTransport(doc: Y.Doc): TransportState {
  const map = transportOf(doc)
  const status = map.get('status') === 'playing' ? 'playing' : 'stopped'
  const shared = map.get('sharedTimeMs')
  const clientId = map.get('clientId')
  return {
    status,
    positionSec: clampNumber(map.get('positionSec'), 0, MAX_SECONDS, 0),
    issuedAt: clampNumber(map.get('issuedAt'), 0, Number.MAX_SAFE_INTEGER, 0),
    clientId: isSafeId(clientId) ? clientId : '',
    sharedTimeMs: typeof shared === 'number' && Number.isFinite(shared) ? shared : undefined,
  }
}

export function writeTransport(doc: Y.Doc, state: TransportState) {
  const map = transportOf(doc)
  doc.transact(() => {
    map.set('status', state.status)
    map.set('positionSec', state.positionSec)
    map.set('issuedAt', state.issuedAt)
    map.set('clientId', state.clientId)
    if (state.sharedTimeMs != null) map.set('sharedTimeMs', state.sharedTimeMs)
  })
}

export function addTrack(doc: Y.Doc, name?: string): Track | null {
  const tracks = tracksOf(doc)
  if (tracks.length >= MAX_TRACKS) return null
  const track: Track = {
    id: crypto.randomUUID(),
    name: cleanLabel(name, `Track ${tracks.length + 1}`),
    volume: 0.8,
    mute: false,
  }
  tracks.push([track])
  return track
}

export function seedDefaultTracks(doc: Y.Doc) {
  const tracks = tracksOf(doc)
  if (tracks.length > 0) return
  doc.transact(() => {
    if (tracksOf(doc).length > 0) return
    tracksOf(doc).push([
      { id: crypto.randomUUID(), name: 'Track 1', volume: 0.8, mute: false },
      { id: crypto.randomUUID(), name: 'Track 2', volume: 0.8, mute: false },
    ])
  })
}

export function updateTrack(doc: Y.Doc, id: string, patch: Partial<Omit<Track, 'id'>>) {
  doc.transact(() => {
    const tracks = tracksOf(doc)
    const arr = tracks.toArray()
    const index = arr.findIndex((track) => track.id === id)
    if (index < 0) return
    const next = sanitizeTrack({ ...arr[index], ...patch, id })
    if (!next) return
    tracks.delete(index, 1)
    tracks.insert(index, [next])
  })
}

export function deleteTrack(doc: Y.Doc, id: string) {
  doc.transact(() => {
    const tracks = tracksOf(doc)
    const arr = tracks.toArray()
    const index = arr.findIndex((track) => track.id === id)
    if (index >= 0) tracks.delete(index, 1)
    const clips = clipsOf(doc)
    const remove: string[] = []
    clips.forEach((clip, key) => {
      if (clip.trackId === id) remove.push(key)
    })
    for (const key of remove) clips.delete(key)
  })
}

export function upsertClip(doc: Y.Doc, clip: Clip): boolean {
  const clips = clipsOf(doc)
  if (!clips.has(clip.id) && clips.size >= MAX_CLIPS) return false
  const safe = sanitizeClip(clip)
  if (!safe) return false
  clips.set(safe.id, safe)
  return true
}

export function deleteClip(doc: Y.Doc, id: string) {
  clipsOf(doc).delete(id)
}

export function putAsset(doc: Y.Doc, asset: AssetMeta): boolean {
  const assets = assetsOf(doc)
  if (!assets.has(asset.id) && assets.size >= MAX_ASSETS) return false
  const safe = sanitizeAsset(asset)
  if (!safe) return false
  assets.set(safe.id, safe)
  return true
}
