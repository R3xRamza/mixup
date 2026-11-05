import type { AssetMeta, Clip, Track } from '../sync/doc'

function sameClips(a: Clip[], b: Clip[]): boolean {
  if (a.length !== b.length) return false
  const byId = new Map(a.map((clip) => [clip.id, clip]))
  for (const clip of b) {
    const other = byId.get(clip.id)
    if (!other) return false
    if (
      other.trackId !== clip.trackId ||
      other.assetId !== clip.assetId ||
      other.startSec !== clip.startSec ||
      other.offsetSec !== clip.offsetSec ||
      other.durationSec !== clip.durationSec
    ) {
      return false
    }
  }
  return true
}

export class ArrangementEngine {
  private master: GainNode
  private trackGains = new Map<string, GainNode>()
  private buffers = new Map<string, AudioBuffer>()
  private clips: Clip[] = []
  private tracks: Track[] = []
  private assets = new Map<string, AssetMeta>()
  private live: AudioBufferSourceNode[] = []
  private playing = false
  private startPosition = 0
  private startAudioTime = 0
  private held = 0

  readonly context: AudioContext

  constructor(context: AudioContext) {
    this.context = context
    this.master = context.createGain()
    this.master.gain.value = 0.85
    this.master.connect(context.destination)
  }

  get isPlaying() {
    return this.playing
  }

  sync(tracks: Track[], clips: Clip[], assets: AssetMeta[], buffers: Map<string, AudioBuffer>) {
    const clipsChanged = !sameClips(this.clips, clips) || buffers !== this.buffers
    this.tracks = tracks
    this.clips = clips
    this.assets = new Map(assets.map((asset) => [asset.id, asset]))
    this.buffers = buffers
    this.applyGains()
    const known = new Set(tracks.map((track) => track.id))
    for (const [id, gain] of this.trackGains) {
      if (!known.has(id)) {
        gain.disconnect()
        this.trackGains.delete(id)
      }
    }
    if (clipsChanged && this.playing) this.play(this.context.currentTime + 0.03, this.positionNow())
  }

  positionNow(): number {
    if (!this.playing) return this.held
    const elapsed = this.context.currentTime - this.startAudioTime
    if (elapsed < 0) return this.startPosition
    return this.startPosition + elapsed
  }

  pause(position: number) {
    this.stopSources()
    this.playing = false
    this.held = Math.max(0, position)
  }

  play(audioTime: number, positionSec: number) {
    this.stopSources()
    this.playing = true
    this.startPosition = Math.max(0, positionSec)
    this.startAudioTime = audioTime
    this.held = this.startPosition
    for (const clip of this.clips) {
      const asset = this.assets.get(clip.assetId)
      if (!asset) continue
      const buffer = this.buffers.get(asset.sha256)
      if (!buffer) continue
      const track = this.tracks.find((item) => item.id === clip.trackId)
      if (!track) continue
      if (clip.startSec + clip.durationSec <= positionSec) continue
      let when = audioTime
      let offset = clip.offsetSec
      let duration = clip.durationSec
      if (positionSec > clip.startSec) {
        const into = positionSec - clip.startSec
        offset += into
        duration -= into
      } else {
        when += clip.startSec - positionSec
      }
      if (offset < 0) {
        duration += offset
        when -= offset
        offset = 0
      }
      if (duration <= 0.01 || offset >= buffer.duration) continue
      duration = Math.min(duration, buffer.duration - offset)
      if (duration <= 0.01) continue
      const source = this.context.createBufferSource()
      source.buffer = buffer
      const gain = this.gainFor(track.id)
      gain.gain.value = track.mute ? 0 : track.volume
      source.connect(gain)
      try {
        source.start(Math.max(when, this.context.currentTime), offset, duration)
      } catch {
        source.disconnect()
        continue
      }
      this.live.push(source)
    }
  }

  dispose() {
    this.stopSources()
    this.master.disconnect()
  }

  private applyGains() {
    for (const track of this.tracks) {
      this.gainFor(track.id).gain.value = track.mute ? 0 : track.volume
    }
  }

  private gainFor(trackId: string) {
    let gain = this.trackGains.get(trackId)
    if (!gain) {
      gain = this.context.createGain()
      gain.connect(this.master)
      this.trackGains.set(trackId, gain)
    }
    return gain
  }

  private stopSources() {
    for (const source of this.live) {
      try {
        source.stop()
      } catch {
        /* already stopped */
      }
      source.disconnect()
    }
    this.live = []
  }
}
