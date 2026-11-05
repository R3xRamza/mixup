import { IndexeddbPersistence } from 'y-indexeddb'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { ArrangementEngine } from '../audio/engine'
import { SharedClock, sharedToAudioTime } from '../audio/clock'
import { computePeaks, type Peaks } from '../audio/peaks'
import { captureMicrophone, RoomSession, type PeerSnapshot } from '../rtc/session'
import { ByteStore, isSha256, sha256Hex } from '../sync/assets'
import { CHUNK_BYTES, MAX_AUDIO_BYTES, type ControlMessage } from '../sync/control'
import { MAX_CLIPS, MAX_TRACKS } from '../sync/guard'
import {
  addTrack,
  assetsOf,
  clipsOf,
  deleteClip,
  deleteTrack,
  putAsset,
  readAssets,
  readClips,
  readTracks,
  readTransport,
  seedDefaultTracks,
  tracksOf,
  transportOf,
  updateTrack,
  upsertClip,
  writeTransport,
  type AssetMeta,
  type Clip,
  type Track,
} from '../sync/doc'
import { splitClip } from '../timeline/edits'

const PALETTE = ['#e0a045', '#5dbea3', '#d4706a', '#7aa2d6', '#c4b15a', '#b07cc4']
const SIGNAL_URL = import.meta.env.VITE_SIGNAL_URL || 'ws://localhost:8787'

export type Presence = {
  clientId: string
  name: string
  color: string
  cursorSec: number | null
}

export type RemoteAudio = {
  id: string
  stream: MediaStream
}

export type StudioSnapshot = {
  tracks: Track[]
  clips: Clip[]
  assets: AssetMeta[]
  peaks: Map<string, Peaks>
  missing: string[]
  peers: PeerSnapshot[]
  presence: Presence[]
  remoteAudio: RemoteAudio[]
  status: string
  banner: string
  micError: string
  micMuted: boolean
  hasMic: boolean
  playing: boolean
  ready: boolean
  clockReady: boolean
  selectedClipId: string | null
  linkCopied: boolean
  roomId: string
  name: string
  color: string
}

type TransportCommand = Extract<ControlMessage, { t: 'transport' }>

type IncomingAsset = {
  byteLength: number
  bytes: Uint8Array
  got: number
}

function colorFor(id: string): string {
  let hash = 0
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) >>> 0
  return PALETTE[hash % PALETTE.length]
}

function rankOf(issuedAt: number, clientId: string): string {
  return `${Math.floor(issuedAt).toString().padStart(16, '0')}:${clientId}`
}

export class StudioController {
  readonly roomId: string
  readonly name: string
  readonly clientId: string
  readonly color: string
  readonly doc: Y.Doc
  readonly awareness: Awareness
  readonly engine: ArrangementEngine
  readonly clock = new SharedClock()
  readonly bytes = new ByteStore()
  localStream: MediaStream | null

  tracks: Track[] = []
  clips: Clip[] = []
  assets: AssetMeta[] = []
  peaks = new Map<string, Peaks>()
  buffers = new Map<string, AudioBuffer>()
  missing = new Set<string>()
  peers: PeerSnapshot[] = []
  presence: Presence[] = []
  remoteAudio: RemoteAudio[] = []
  status = 'Connecting…'
  banner = ''
  micError = ''
  micMuted = false
  playing = false
  ready = false
  selectedClipId: string | null = null
  linkCopied = false
  private snap: StudioSnapshot
  private listeners = new Set<() => void>()
  private session: RoomSession
  private persistence: IndexeddbPersistence
  private destroyed = false
  private idbReady = false
  private joined = false
  private isHost = false
  private seeded = false
  private seedTimer = 0
  private pingTimer = 0
  private beatTimer = 0
  private copyTimer = 0
  private bannerTimer = 0
  private lastRank = ''
  private scheduleToken = 0
  private queuedLocal: number | null = null
  private queuedRemote: TransportCommand | null = null
  private incoming = new Map<string, IncomingAsset>()
  private inflight = new Set<string>()
  private have = new Set<string>()
  private assetKey = ''
  private knownLeader = ''
  private appliedTransportAt = 0
  private cursorTimer = 0
  private pendingCursor: number | null = null
  private onKey: (event: KeyboardEvent) => void

  constructor(opts: {
    roomId: string
    name: string
    clientId: string
    ctx: AudioContext
    stream: MediaStream | null
    micError: string
    micLater?: Promise<MediaStream | null>
  }) {
    this.roomId = opts.roomId
    this.name = opts.name
    this.clientId = opts.clientId
    this.color = colorFor(opts.clientId)
    this.localStream = opts.stream
    this.micError = opts.micError
    this.doc = new Y.Doc()
    this.awareness = new Awareness(this.doc)
    this.awareness.setLocalState({
      name: opts.name,
      color: this.color,
      peerId: opts.clientId,
      cursorSec: null,
    })
    this.engine = new ArrangementEngine(opts.ctx)
    this.snap = this.buildSnapshot()
    this.persistence = new IndexeddbPersistence(`mixup-${opts.roomId}`, this.doc)
    this.session = new RoomSession({
      roomId: opts.roomId,
      clientId: opts.clientId,
      name: opts.name,
      signalUrl: SIGNAL_URL,
      doc: this.doc,
      awareness: this.awareness,
      localStream: opts.stream,
      onPeers: (peers) => {
        this.peers = peers
        this.emit()
      },
      onControl: (from, msg) => this.onControl(from, msg),
      onControlOpen: (peerId) => this.onControlOpen(peerId),
      onRemoteStream: (peerId, stream) => this.setRemoteStream(peerId, stream),
      onLocalStream: (stream) => {
        this.localStream = stream
        this.emit()
      },
      onJoined: ({ isHost }) => {
        this.joined = true
        this.isHost = isHost
        this.scheduleSeed()
      },
      onLeader: (leaderId) => this.adoptLeader(leaderId),
      onStatus: (status) => {
        this.status = status
        this.emit()
      },
      onError: (message) => this.setBanner(message),
      onPeerLeft: () => {
        this.emit()
      },
    })

    const refresh = () => {
      if (this.destroyed) return
      this.tracks = readTracks(this.doc)
      this.clips = readClips(this.doc)
      this.assets = readAssets(this.doc)
      if (this.selectedClipId && !this.clips.some((clip) => clip.id === this.selectedClipId)) {
        this.selectedClipId = null
      }
      this.engine.sync(this.tracks, this.clips, this.assets, this.buffers)
      const key = this.assets.map((asset) => asset.sha256).join('|')
      if (key !== this.assetKey) {
        this.assetKey = key
        void this.fetchMissingAssets()
      }
      if (this.tracks.length > 0) this.seeded = true
      this.emit()
    }
    tracksOf(this.doc).observe(refresh)
    clipsOf(this.doc).observe(refresh)
    assetsOf(this.doc).observe(refresh)
    transportOf(this.doc).observe(() => this.adoptTransportFromDoc())

    this.awareness.on('change', () => {
      const next = this.readPresence()
      if (JSON.stringify(next) !== JSON.stringify(this.presence)) {
        this.presence = next
        this.emit()
      }
    })

    void this.persistence.whenSynced.then(() => {
      if (this.destroyed) return
      this.idbReady = true
      this.adoptTransportFromDoc()
      this.ready = true
      refresh()
      this.scheduleSeed()
    })

    this.onKey = (event) => this.handleKey(event)
    window.addEventListener('keydown', this.onKey)
    this.pingTimer = window.setInterval(() => this.sendPing(), 2000)
    this.beatTimer = window.setInterval(() => {
      if (!this.destroyed) this.awareness.setLocalStateField('beat', Date.now())
    }, 15000)
    if (opts.micLater) {
      void opts.micLater.then((stream) => {
        if (this.destroyed || !stream) {
          stream?.getTracks().forEach((track) => track.stop())
          return
        }
        void this.session.adoptStream(stream).then(() => {
          this.localStream = this.session.localStream
          this.micError = ''
          this.micMuted = false
          this.emit()
        })
      })
    }
    if (import.meta.env.DEV) {
      ;(window as unknown as { __mixup?: StudioController }).__mixup = this
    }
  }

  start() {
    this.session.start()
  }

  destroy() {
    this.destroyed = true
    window.clearTimeout(this.seedTimer)
    window.clearTimeout(this.copyTimer)
    window.clearTimeout(this.bannerTimer)
    window.clearTimeout(this.cursorTimer)
    window.clearInterval(this.pingTimer)
    window.clearInterval(this.beatTimer)
    window.removeEventListener('keydown', this.onKey)
    this.session.destroy()
    this.engine.dispose()
    void this.persistence.destroy()
    this.doc.destroy()
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  snapshot(): StudioSnapshot {
    return this.snap
  }

  positionNow(): number {
    return this.engine.positionNow()
  }

  togglePlay() {
    if (this.playing) this.stop()
    else this.playFrom(this.engine.positionNow())
  }

  playFrom(positionSec: number) {
    if (!this.clock.ready) {
      this.queuedLocal = Math.max(0, positionSec)
      this.sendPing()
      return
    }
    this.beginPlay(Math.max(0, positionSec))
  }

  stop() {
    this.scheduleToken += 1
    const position = this.engine.positionNow()
    this.engine.pause(position)
    this.playing = false
    this.queuedLocal = null
    this.queuedRemote = null
    const command = this.command('stop', position)
    this.remember(command)
    writeTransport(this.doc, {
      status: 'stopped',
      positionSec: position,
      issuedAt: command.issuedAt,
      clientId: this.clientId,
    })
    this.session.sendControl(command)
    this.emit()
  }

  seek(positionSec: number) {
    const position = Math.max(0, positionSec)
    if (this.playing) {
      this.playFrom(position)
      return
    }
    this.queuedRemote = null
    this.engine.pause(position)
    const command = this.command('seek', position)
    this.remember(command)
    writeTransport(this.doc, {
      status: 'stopped',
      positionSec: position,
      issuedAt: command.issuedAt,
      clientId: this.clientId,
    })
    this.session.sendControl(command)
    this.emit()
  }

  select(id: string | null) {
    this.selectedClipId = id
    this.emit()
  }

  commitClip(clip: Clip) {
    upsertClip(this.doc, clip)
  }

  removeSelected() {
    if (!this.selectedClipId) return
    deleteClip(this.doc, this.selectedClipId)
    this.selectedClipId = null
  }

  splitSelected() {
    if (!this.selectedClipId) return
    const clip = this.clips.find((item) => item.id === this.selectedClipId)
    if (!clip) return
    const parts = splitClip(clip, this.engine.positionNow())
    if (!parts) {
      this.setBanner('Move the playhead inside the selected clip, then split.')
      return
    }
    if (clipsOf(this.doc).size >= MAX_CLIPS) {
      this.setBanner(`A session can have up to ${MAX_CLIPS} clips.`)
      return
    }
    this.doc.transact(() => {
      upsertClip(this.doc, parts.left)
      upsertClip(this.doc, parts.right)
    })
    this.selectedClipId = parts.right.id
  }

  addTrack() {
    if (!addTrack(this.doc)) this.setBanner(`A session can have up to ${MAX_TRACKS} tracks.`)
  }

  renameTrack(id: string, name: string) {
    const trimmed = name.trim().slice(0, 40)
    if (!trimmed) return
    updateTrack(this.doc, id, { name: trimmed })
  }

  setVolume(id: string, volume: number) {
    updateTrack(this.doc, id, { volume: Math.min(1, Math.max(0, volume)) })
  }

  toggleMute(id: string) {
    const track = this.tracks.find((item) => item.id === id)
    if (!track) return
    updateTrack(this.doc, id, { mute: !track.mute })
  }

  removeTrack(id: string) {
    deleteTrack(this.doc, id)
  }

  setCursor(sec: number | null) {
    this.pendingCursor = sec
    if (this.cursorTimer) return
    this.cursorTimer = window.setTimeout(() => {
      this.cursorTimer = 0
      if (this.destroyed) return
      this.awareness.setLocalStateField('cursorSec', this.pendingCursor)
    }, 40)
  }

  async toggleMic() {
    if (!this.localStream) {
      try {
        await this.session.enableMic()
        this.localStream = this.session.localStream
        this.micError = ''
        this.micMuted = false
        this.emit()
      } catch {
        this.micError = 'Microphone is still blocked in the browser settings.'
        this.emit()
      }
      return
    }
    this.micMuted = !this.micMuted
    this.session.setMicMuted(this.micMuted)
    this.emit()
  }

  async copyLink() {
    const url = new URL(window.location.href)
    url.search = ''
    url.searchParams.set('room', this.roomId)
    try {
      await navigator.clipboard.writeText(url.toString())
      this.linkCopied = true
      this.emit()
      window.clearTimeout(this.copyTimer)
      this.copyTimer = window.setTimeout(() => {
        this.linkCopied = false
        this.emit()
      }, 1600)
    } catch {
      this.setBanner(url.toString())
    }
  }

  async importFiles(files: File[]) {
    const list = [...files]
    if (list.length === 0) return
    let trackId = this.importTrackId()
    if (!trackId) {
      const created = addTrack(this.doc)
      if (!created) {
        this.setBanner(`A session can have up to ${MAX_TRACKS} tracks.`)
        return
      }
      trackId = created.id
    }
    let start = this.playing ? this.engine.positionNow() : this.engine.positionNow()
    for (const file of list) {
      if (file.size > MAX_AUDIO_BYTES) {
        this.setBanner(`${file.name} is over 30 MB.`)
        continue
      }
      try {
        const raw = await file.arrayBuffer()
        const sha256 = await sha256Hex(raw)
        const audio = await this.decode(raw)
        await this.bytes.put(sha256, raw)
        this.rememberBuffer(sha256, audio)
        const asset: AssetMeta = {
          id: crypto.randomUUID(),
          name: file.name,
          durationSec: audio.duration,
          mime: file.type || 'application/octet-stream',
          byteLength: raw.byteLength,
          sha256,
        }
        const clip: Clip = {
          id: crypto.randomUUID(),
          trackId,
          assetId: asset.id,
          startSec: Math.max(0, start),
          offsetSec: 0,
          durationSec: audio.duration,
        }
        let saved = false
        this.doc.transact(() => {
          saved = putAsset(this.doc, asset) && upsertClip(this.doc, clip)
        })
        if (!saved) {
          this.setBanner('This session has hit the clip or file limit.')
          break
        }
        this.selectedClipId = clip.id
        start += audio.duration
      } catch (error) {
        console.error(error)
        this.setBanner(`${file.name} could not be decoded. Try wav, mp3, ogg, flac, or m4a.`)
      }
    }
  }

  dismissBanner() {
    this.banner = ''
    this.emit()
  }

  private importTrackId(): string | null {
    if (this.selectedClipId) {
      const clip = this.clips.find((item) => item.id === this.selectedClipId)
      if (clip && this.tracks.some((track) => track.id === clip.trackId)) return clip.trackId
    }
    return this.tracks[0]?.id ?? null
  }

  private beginPlay(positionSec: number) {
    const lead = 180
    const sharedTimeMs = this.clock.sharedNow() + lead
    const command = this.command('play', positionSec, sharedTimeMs)
    this.remember(command)
    this.playing = true
    writeTransport(this.doc, {
      status: 'playing',
      positionSec,
      issuedAt: command.issuedAt,
      clientId: this.clientId,
      sharedTimeMs,
    })
    this.session.sendControl(command)
    this.schedule(positionSec, sharedTimeMs)
  }

  private schedule(positionSec: number, sharedTimeMs: number) {
    const ctx = this.engine.context
    if (ctx.state === 'suspended') {
      const token = this.scheduleToken
      void ctx.resume().then(() => {
        if (!this.destroyed && token === this.scheduleToken) this.schedule(positionSec, sharedTimeMs)
      })
      return
    }
    const when = sharedToAudioTime(sharedTimeMs, this.clock.offsetMs, ctx)
    let position = positionSec
    let audioWhen = when
    const now = ctx.currentTime
    if (audioWhen < now - 0.02) {
      position += now - audioWhen
      audioWhen = now + 0.01
    }
    this.engine.play(audioWhen, position)
    this.playing = true
    this.emit()
  }

  private command(
    action: TransportCommand['action'],
    positionSec: number,
    sharedTimeMs?: number,
  ): TransportCommand {
    return {
      t: 'transport',
      action,
      positionSec,
      sharedTimeMs,
      issuedAt: Date.now(),
      clientId: this.clientId,
    }
  }

  private remember(command: TransportCommand) {
    this.lastRank = rankOf(command.issuedAt, command.clientId)
  }

  private isNewer(command: TransportCommand): boolean {
    const rank = rankOf(command.issuedAt, command.clientId)
    if (rank <= this.lastRank) return false
    this.lastRank = rank
    return true
  }

  private onControl(from: string, msg: ControlMessage) {
    if (msg.t === 'ping') {
      if (this.session.leaderId === this.clientId) {
        this.session.sendControl({ t: 'pong', id: msg.id, t0: msg.t0, t1: performance.now() }, from)
      }
      return
    }
    if (msg.t === 'pong') {
      const wasReady = this.clock.ready
      this.clock.notePong(msg.t0, msg.t1, performance.now())
      if (!wasReady && this.clock.ready) this.flushQueued()
      if (this.snap.clockReady !== this.clock.ready) this.emit()
      return
    }
    if (msg.t === 'transport') {
      this.onTransport(msg)
      return
    }
    if (msg.t === 'asset-request') {
      void this.serveAsset(msg.sha256, from)
      return
    }
    if (msg.t === 'asset-begin') {
      if (!isSha256(msg.sha256) || this.have.has(msg.sha256) || msg.byteLength <= 0) return
      if (msg.byteLength > MAX_AUDIO_BYTES) return
      if (this.incoming.size >= 4 && !this.incoming.has(msg.sha256)) return
      this.incoming.set(msg.sha256, {
        byteLength: msg.byteLength,
        bytes: new Uint8Array(msg.byteLength),
        got: 0,
      })
      return
    }
    if (msg.t === 'asset-chunk') {
      const incoming = this.incoming.get(msg.sha256)
      if (!incoming) return
      if (msg.offset < 0 || msg.offset + msg.data.length > incoming.bytes.length) return
      incoming.bytes.set(msg.data, msg.offset)
      incoming.got += msg.data.length
      return
    }
    if (msg.t === 'asset-end') {
      const incoming = this.incoming.get(msg.sha256)
      this.incoming.delete(msg.sha256)
      if (!incoming || incoming.got < incoming.byteLength) {
        this.inflight.delete(msg.sha256)
        this.session.sendControl({ t: 'asset-request', sha256: msg.sha256 }, from)
        return
      }
      const copy = new ArrayBuffer(incoming.bytes.byteLength)
      new Uint8Array(copy).set(incoming.bytes)
      void this.storeDecoded(msg.sha256, copy)
    }
  }

  private onTransport(msg: TransportCommand) {
    if (!Number.isFinite(msg.positionSec)) return
    if (!this.isNewer(msg)) return
    if (msg.action === 'stop' || (msg.action === 'seek' && msg.sharedTimeMs == null)) {
      this.queuedRemote = null
      this.engine.pause(Math.max(0, msg.positionSec))
      this.playing = false
      this.emit()
      return
    }
    if (msg.sharedTimeMs == null) return
    if (!this.clock.ready) {
      this.queuedRemote = msg
      this.sendPing()
      return
    }
    this.schedule(Math.max(0, msg.positionSec), msg.sharedTimeMs)
  }

  private flushQueued() {
    const remote = this.queuedRemote
    const local = this.queuedLocal
    this.queuedRemote = null
    this.queuedLocal = null
    if (remote && (local == null || rankOf(remote.issuedAt, remote.clientId) >= this.lastRank)) {
      if (remote.sharedTimeMs != null) this.schedule(Math.max(0, remote.positionSec), remote.sharedTimeMs)
      return
    }
    if (local != null) this.beginPlay(local)
  }

  private onControlOpen(peerId: string) {
    this.sendPing()
    if (this.playing && this.clock.ready) {
      const lead = 200
      const sharedTimeMs = this.clock.sharedNow() + lead
      const positionSec = this.engine.positionNow() + lead / 1000
      this.session.sendControl(this.command('play', positionSec, sharedTimeMs), peerId)
    }
    for (const sha of this.missing) {
      this.session.sendControl({ t: 'asset-request', sha256: sha }, peerId)
    }
  }

  private async fetchMissingAssets() {
    for (const asset of this.assets) {
      const sha = asset.sha256
      if (!isSha256(sha) || this.have.has(sha) || this.inflight.has(sha)) continue
      this.inflight.add(sha)
      try {
        const local = await this.bytes.get(sha)
        if (local) {
          await this.storeDecoded(sha, local)
        } else {
          this.missing.add(sha)
          this.emit()
          this.session.sendControl({ t: 'asset-request', sha256: sha })
        }
      } catch (error) {
        console.error(error)
        this.inflight.delete(sha)
      }
    }
  }

  private async serveAsset(sha256: string, to: string) {
    if (!isSha256(sha256)) return
    const data = await this.bytes.get(sha256)
    if (!data) return
    const bytes = new Uint8Array(data)
    this.session.sendControl({ t: 'asset-begin', sha256, byteLength: bytes.byteLength }, to)
    for (let offset = 0; offset < bytes.byteLength; offset += CHUNK_BYTES) {
      const dataSlice = bytes.subarray(offset, Math.min(bytes.byteLength, offset + CHUNK_BYTES))
      this.session.sendControl({ t: 'asset-chunk', sha256, offset, data: dataSlice }, to)
      if ((offset / CHUNK_BYTES) % 4 === 3) {
        await new Promise((resolve) => window.setTimeout(resolve, 0))
      }
    }
    this.session.sendControl({ t: 'asset-end', sha256 }, to)
  }

  private async storeDecoded(sha256: string, data: ArrayBuffer) {
    try {
      await this.bytes.put(sha256, data)
      const audio = await this.decode(data)
      this.rememberBuffer(sha256, audio)
    } catch (error) {
      console.error(error)
      this.inflight.delete(sha256)
      this.setBanner('A received audio file could not be decoded.')
    }
  }

  private rememberBuffer(sha256: string, audio: AudioBuffer) {
    this.have.add(sha256)
    this.inflight.delete(sha256)
    this.missing.delete(sha256)
    this.incoming.delete(sha256)
    const buffers = new Map(this.buffers)
    buffers.set(sha256, audio)
    this.buffers = buffers
    const peaks = new Map(this.peaks)
    peaks.set(sha256, computePeaks(audio))
    this.peaks = peaks
    this.engine.sync(this.tracks, this.clips, this.assets, this.buffers)
    this.emit()
  }

  private async decode(data: ArrayBuffer): Promise<AudioBuffer> {
    return this.engine.context.decodeAudioData(data.slice(0))
  }

  private setRemoteStream(peerId: string, stream: MediaStream | null) {
    this.remoteAudio = this.remoteAudio.filter((item) => item.id !== peerId)
    if (stream) this.remoteAudio = [...this.remoteAudio, { id: peerId, stream }]
    this.emit()
  }

  private adoptLeader(leaderId: string) {
    if (!leaderId || leaderId === this.knownLeader) return
    this.knownLeader = leaderId
    if (leaderId === this.clientId) {
      const became = !this.clock.ready
      this.clock.becomeLeader()
      if (became) this.flushQueued()
    } else {
      this.clock.invalidate()
      this.sendPing()
    }
    this.emit()
  }

  private adoptTransportFromDoc() {
    const transport = readTransport(this.doc)
    if (transport.issuedAt <= this.appliedTransportAt) return
    this.appliedTransportAt = transport.issuedAt
    if (this.playing) return
    this.engine.pause(transport.positionSec)
    this.emit()
  }

  private sendPing() {
    if (this.destroyed) return
    if (this.session.leaderId === this.clientId) return
    this.session.sendControl(
      { t: 'ping', id: crypto.randomUUID(), t0: performance.now() },
      this.session.leaderId,
    )
  }

  private scheduleSeed() {
    if (this.seeded || !this.idbReady || !this.joined || !this.isHost) return
    if (readTracks(this.doc).length > 0) {
      this.seeded = true
      return
    }
    window.clearTimeout(this.seedTimer)
    const delay = this.peers.length > 0 ? 2000 : 250
    this.seedTimer = window.setTimeout(() => {
      if (this.destroyed || this.seeded) return
      if (readTracks(this.doc).length === 0) seedDefaultTracks(this.doc)
      this.seeded = true
    }, delay)
  }

  private readPresence(): Presence[] {
    const list: Presence[] = []
    this.awareness.getStates().forEach((state, id) => {
      if (id === this.awareness.clientID || !state) return
      const cursor = (state as { cursorSec?: number | null }).cursorSec
      list.push({
        clientId: String((state as { peerId?: string }).peerId ?? id),
        name: String((state as { name?: string }).name ?? 'Guest'),
        color: String((state as { color?: string }).color ?? '#e0a045'),
        cursorSec: typeof cursor === 'number' ? cursor : null,
      })
    })
    return list
  }

  private handleKey(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null
    const tag = target?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return
    if (event.code === 'Space') {
      event.preventDefault()
      this.togglePlay()
      return
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && this.selectedClipId) {
      event.preventDefault()
      this.removeSelected()
      return
    }
    if ((event.key === 's' || event.key === 'S') && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault()
      this.splitSelected()
    }
  }

  private setBanner(message: string) {
    this.banner = message
    this.emit()
    window.clearTimeout(this.bannerTimer)
    this.bannerTimer = window.setTimeout(() => {
      if (this.banner === message) {
        this.banner = ''
        this.emit()
      }
    }, 7000)
  }

  private buildSnapshot(): StudioSnapshot {
    return {
      tracks: this.tracks,
      clips: this.clips,
      assets: this.assets,
      peaks: this.peaks,
      missing: [...this.missing],
      peers: this.peers,
      presence: this.presence,
      remoteAudio: this.remoteAudio,
      status: this.status,
      banner: this.banner,
      micError: this.micError,
      micMuted: this.micMuted,
      hasMic: Boolean(this.localStream),
      playing: this.playing,
      ready: this.ready,
      clockReady: this.clock.ready,
      selectedClipId: this.selectedClipId,
      linkCopied: this.linkCopied,
      roomId: this.roomId,
      name: this.name,
      color: this.color,
    }
  }

  private emit() {
    this.snap = this.buildSnapshot()
    for (const listener of this.listeners) listener()
  }
}

export function loadClientId(): string {
  const key = 'mixup-client-id'
  const existing = sessionStorage.getItem(key)
  if (existing) return existing
  const created = crypto.randomUUID()
  sessionStorage.setItem(key, created)
  return created
}

export function cleanRoom(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32)
}

export function cleanName(input: string): string {
  return input
    .replace(/[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 32)
}

export function randomRoom(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  let room = ''
  for (const byte of bytes) room += alphabet[byte % alphabet.length]
  return room
}

export async function prepareAudio(): Promise<{
  ctx: AudioContext
  stream: MediaStream | null
  micError: string
  micLater: Promise<MediaStream | null>
}> {
  const mic = captureMicrophone()
  const ctx = new AudioContext()
  await ctx.resume()
  const first = await mic.first
  return { ctx, stream: first.stream, micError: first.error, micLater: mic.later }
}

