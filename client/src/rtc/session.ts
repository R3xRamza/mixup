import type { Awareness } from 'y-protocols/awareness'
import type * as Y from 'yjs'
import {
  controlPriority,
  decodeControl,
  encodeControl,
  type ControlMessage,
} from '../sync/control'
import { bindSyncChannel, dropPeerAwareness } from '../sync/provider'

export type SignalPayload =
  | { kind: 'offer'; sdp: RTCSessionDescriptionInit }
  | { kind: 'answer'; sdp: RTCSessionDescriptionInit }
  | { kind: 'ice'; candidate: RTCIceCandidateInit }
  | { kind: 'please-offer' }
  | { kind: 'restart' }

export type PeerSnapshot = {
  id: string
  name: string
  status: 'connecting' | 'connected' | 'closed'
}

type Link = {
  id: string
  name: string
  pc: RTCPeerConnection
  control: RTCDataChannel | null
  status: PeerSnapshot['status']
  pendingIce: RTCIceCandidateInit[]
  unsubSync?: () => void
  makingOffer: boolean
  queue?: ChannelQueue
}

class ChannelQueue {
  private high: Uint8Array[] = []
  private low: Uint8Array[] = []
  private pumping = false

  constructor(private channel: RTCDataChannel) {}

  push(data: Uint8Array, priority: number) {
    if (priority === 0) this.high.push(data)
    else this.low.push(data)
    this.pump()
  }

  private pump() {
    if (this.pumping) return
    this.pumping = true
    const step = () => {
      if (this.channel.readyState !== 'open') {
        this.pumping = false
        return
      }
      if (this.channel.bufferedAmount > 256 * 1024) {
        window.setTimeout(step, 20)
        return
      }
      const next = this.high.shift() ?? this.low.shift()
      if (!next) {
        this.pumping = false
        return
      }
      this.channel.send(next as Uint8Array<ArrayBuffer>)
      if (this.high.length === 0 && this.low.length > 0) window.setTimeout(step, 0)
      else step()
    }
    step()
  }
}

export type RoomSessionOptions = {
  roomId: string
  clientId: string
  name: string
  signalUrl: string
  doc: Y.Doc
  awareness: Awareness
  localStream: MediaStream | null
  onPeers: (peers: PeerSnapshot[]) => void
  onControl: (from: string, msg: ControlMessage) => void
  onControlOpen: (peerId: string) => void
  onRemoteStream: (peerId: string, stream: MediaStream | null) => void
  onLocalStream: (stream: MediaStream | null) => void
  onJoined: (info: { isHost: boolean; leaderId: string }) => void
  onLeader: (leaderId: string) => void
  onStatus: (status: string) => void
  onError: (message: string) => void
  onPeerLeft: (peerId: string) => void
}

export class RoomSession {
  localStream: MediaStream | null
  micMuted = false
  private ws: WebSocket | null = null
  private links = new Map<string, Link>()
  private names = new Map<string, string>()
  private members = new Set<string>()
  private signalQueue = new Map<string, SignalPayload[]>()
  private connectJobs = new Map<string, Promise<void>>()
  private closed = false
  private socketTimer = 0
  leaderId: string

  constructor(private opts: RoomSessionOptions) {
    this.localStream = opts.localStream
    this.leaderId = opts.clientId
    this.members.add(opts.clientId)
  }

  start() {
    this.closed = false
    this.opts.onLocalStream(this.localStream)
    this.opts.onStatus('Connecting to signaling…')
    this.connectSocket()
  }

  destroy() {
    this.closed = true
    window.clearTimeout(this.socketTimer)
    this.closeAllLinks()
    this.ws?.close()
    this.ws = null
    this.localStream?.getTracks().forEach((track) => track.stop())
    this.localStream = null
  }

  setMicMuted(muted: boolean) {
    this.micMuted = muted
    this.localStream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted
    })
  }

  async enableMic(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    })
    await this.adoptStream(stream)
  }

  async adoptStream(stream: MediaStream): Promise<void> {
    this.localStream?.getTracks().forEach((track) => track.stop())
    this.localStream = stream
    this.micMuted = false
    this.opts.onLocalStream(stream)
    const peers = [...this.links.values()].map((link) => ({ id: link.id, name: link.name }))
    for (const peer of peers) {
      this.sendSignal(peer.id, { kind: 'restart' })
      this.forgetPeer(peer.id, false)
    }
    for (const peer of peers) await this.connectTo(peer.id, peer.name)
  }

  sendControl(msg: ControlMessage, to?: string) {
    const bytes = encodeControl(msg)
    const priority = controlPriority(msg)
    for (const link of this.links.values()) {
      if (to && link.id !== to) continue
      if (!link.queue || link.control?.readyState !== 'open') continue
      link.queue.push(bytes, priority)
    }
  }

  private connectSocket() {
    if (this.closed) return
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return
    }
    const ws = new WebSocket(this.opts.signalUrl)
    this.ws = ws
    ws.onopen = () => {
      this.opts.onStatus('Joining room…')
      ws.send(
        JSON.stringify({
          type: 'join',
          roomId: this.opts.roomId,
          clientId: this.opts.clientId,
          name: this.opts.name,
        }),
      )
    }
    ws.onmessage = (event) => {
      try {
        this.onSocket(JSON.parse(String(event.data)) as Record<string, unknown>)
      } catch (error) {
        console.error('signal parse', error)
      }
    }
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null
      this.closeAllLinks()
      if (this.closed) return
      this.opts.onStatus('Reconnecting…')
      this.socketTimer = window.setTimeout(() => this.connectSocket(), 1200)
    }
  }

  private onSocket(msg: Record<string, unknown>) {
    if (msg.type === 'error') {
      this.opts.onError(typeof msg.message === 'string' ? msg.message : 'Signaling error')
      return
    }
    if (msg.type === 'joined') {
      const peers = Array.isArray(msg.peers) ? msg.peers : []
      this.members.clear()
      this.members.add(this.opts.clientId)
      const peerList: { clientId: string; name: string }[] = []
      for (const peer of peers) {
        if (!peer || typeof peer !== 'object') continue
        const clientId = String((peer as { clientId?: string }).clientId ?? '')
        const name = String((peer as { name?: string }).name ?? 'Guest')
        if (!clientId) continue
        peerList.push({ clientId, name })
        this.members.add(clientId)
        this.names.set(clientId, name)
      }
      const leader = typeof msg.leaderId === 'string' ? msg.leaderId : this.opts.clientId
      this.leaderId = leader
      this.opts.onLeader(leader)
      this.opts.onJoined({ isHost: Boolean(msg.isHost), leaderId: leader })
      this.opts.onStatus(peerList.length ? 'Connecting to peers…' : 'Waiting for someone to join')
      for (const peer of peerList) void this.connectTo(peer.clientId, peer.name)
      this.emitPeers()
      return
    }
    if (msg.type === 'peer-joined') {
      const clientId = String(msg.clientId ?? '')
      const name = String(msg.name ?? 'Guest')
      if (!clientId || clientId === this.opts.clientId) return
      this.members.add(clientId)
      this.names.set(clientId, name)
      this.opts.onStatus('Connecting to peers…')
      void this.connectTo(clientId, name)
      this.emitPeers()
      return
    }
    if (msg.type === 'peer-left') {
      const clientId = String(msg.clientId ?? '')
      this.members.delete(clientId)
      this.forgetPeer(clientId)
      return
    }
    if (msg.type === 'leader') {
      const leader = String(msg.leaderId ?? '')
      if (!leader) return
      this.leaderId = leader
      this.opts.onLeader(leader)
      return
    }
    if (msg.type === 'signal') {
      const from = String(msg.from ?? '')
      const payload = msg.payload as SignalPayload | undefined
      if (!from || !payload || typeof payload !== 'object' || !('kind' in payload)) return
      void this.enqueueSignal(from, payload)
    }
  }

  private async enqueueSignal(from: string, payload: SignalPayload) {
    const queued = this.signalQueue.get(from) ?? []
    queued.push(payload)
    this.signalQueue.set(from, queued)
    await this.connectTo(from, this.names.get(from) ?? 'Guest')
    this.flushSignals(from)
  }

  private connectTo(peerId: string, name: string): Promise<void> {
    if (peerId === this.opts.clientId) return Promise.resolve()
    const existing = this.connectJobs.get(peerId)
    if (existing) return existing
    const job = this.connectInner(peerId, name).finally(() => {
      this.connectJobs.delete(peerId)
    })
    this.connectJobs.set(peerId, job)
    return job
  }

  private async connectInner(peerId: string, name: string) {
    this.names.set(peerId, name)
    this.members.add(peerId)
    let link = this.links.get(peerId)
    if (link && link.status !== 'closed' && link.pc.connectionState !== 'closed') {
      link.name = name
      this.flushSignals(peerId)
      return
    }
    if (link) this.forgetPeer(peerId, false)

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    })
    link = {
      id: peerId,
      name,
      pc,
      control: null,
      status: 'connecting',
      pendingIce: [],
      makingOffer: false,
    }
    this.links.set(peerId, link)
    this.bindPeer(link)
    if (this.opts.clientId < peerId) {
      await this.addLocalTracks(link)
      this.openChannels(link)
      await this.offer(link)
    } else {
      pc.ondatachannel = (event) => this.takeChannel(link as Link, event.channel)
    }
    this.flushSignals(peerId)
    this.emitPeers()
  }

  private bindPeer(link: Link) {
    const { pc } = link
    pc.onicecandidate = (event) => {
      if (!event.candidate) return
      this.sendSignal(link.id, { kind: 'ice', candidate: event.candidate.toJSON() })
    }
    pc.ontrack = (event) => {
      const [stream] = event.streams
      this.opts.onRemoteStream(link.id, stream ?? new MediaStream([event.track]))
    }
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') link.status = 'connected'
      else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') link.status = 'closed'
      else link.status = 'connecting'
      this.emitPeers()
      this.refreshStatus()
    }
  }

  private async addLocalTracks(link: Link) {
    const track = this.localStream?.getAudioTracks()[0] ?? null
    if (track) track.enabled = !this.micMuted
    const existing = link.pc.getTransceivers().find((item) => item.receiver.track.kind === 'audio')
    if (existing) {
      if (track) {
        existing.direction = 'sendrecv'
        await existing.sender.replaceTrack(track)
      }
      return
    }
    if (track && this.localStream) {
      link.pc.addTrack(track, this.localStream)
      return
    }
    link.pc.addTransceiver('audio', { direction: 'recvonly' })
  }

  private openChannels(link: Link) {
    this.takeChannel(link, link.pc.createDataChannel('sync', { ordered: true }))
    this.takeChannel(link, link.pc.createDataChannel('control', { ordered: true }))
  }

  private takeChannel(link: Link, channel: RTCDataChannel) {
    channel.binaryType = 'arraybuffer'
    if (channel.label === 'sync') {
      link.unsubSync?.()
      link.unsubSync = bindSyncChannel(this.opts.doc, this.opts.awareness, channel, link.id)
      return
    }
    if (channel.label !== 'control') return
    link.control = channel
    const queue = new ChannelQueue(channel)
    link.queue = queue
    const announce = () => {
      link.status = 'connected'
      this.emitPeers()
      this.refreshStatus()
      this.opts.onControlOpen(link.id)
    }
    channel.onmessage = (event) => {
      try {
        const msg = decodeControl(event.data as ArrayBuffer)
        this.opts.onControl(link.id, msg)
      } catch (error) {
        console.error('control message', error)
      }
    }
    if (channel.readyState === 'open') announce()
    else channel.addEventListener('open', announce, { once: true })
  }

  private async offer(link: Link) {
    if (link.makingOffer || link.pc.connectionState === 'closed') return
    link.makingOffer = true
    try {
      const offer = await link.pc.createOffer()
      if (link.pc.signalingState !== 'stable' && link.pc.signalingState !== 'have-local-offer') return
      await link.pc.setLocalDescription(offer)
      if (link.pc.localDescription) {
        this.sendSignal(link.id, { kind: 'offer', sdp: link.pc.localDescription.toJSON() })
      }
    } catch (error) {
      console.error('offer', error)
    } finally {
      link.makingOffer = false
    }
  }

  private flushSignals(peerId: string) {
    const link = this.links.get(peerId)
    const queued = this.signalQueue.get(peerId)
    if (!link || !queued?.length) return
    this.signalQueue.set(peerId, [])
    for (const payload of queued) void this.handleSignal(link, payload)
  }

  private async handleSignal(link: Link, payload: SignalPayload) {
    try {
      if (payload.kind === 'please-offer') {
        if (this.opts.clientId < link.id) await this.offer(link)
        return
      }
      if (payload.kind === 'restart') {
        const { id, name } = link
        this.forgetPeer(id, false)
        await this.connectTo(id, name)
        return
      }
      if (payload.kind === 'offer') {
        if (this.opts.clientId < link.id && link.pc.signalingState !== 'stable') return
        await link.pc.setRemoteDescription(payload.sdp)
        await this.flushIce(link)
        await this.addLocalTracks(link)
        const answer = await link.pc.createAnswer()
        await link.pc.setLocalDescription(answer)
        if (link.pc.localDescription) {
          this.sendSignal(link.id, { kind: 'answer', sdp: link.pc.localDescription.toJSON() })
        }
        return
      }
      if (payload.kind === 'answer') {
        if (link.pc.signalingState !== 'have-local-offer') return
        await link.pc.setRemoteDescription(payload.sdp)
        await this.flushIce(link)
        return
      }
      if (payload.kind === 'ice') {
        if (!payload.candidate) return
        if (!link.pc.remoteDescription) {
          link.pendingIce.push(payload.candidate)
          return
        }
        await link.pc.addIceCandidate(payload.candidate)
      }
    } catch (error) {
      console.error('signal', payload.kind, error)
    }
  }

  private async flushIce(link: Link) {
    const pending = link.pendingIce.splice(0)
    for (const candidate of pending) {
      try {
        await link.pc.addIceCandidate(candidate)
      } catch (error) {
        console.error('ice', error)
      }
    }
  }

  private sendSignal(to: string, payload: SignalPayload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    this.ws.send(JSON.stringify({ type: 'signal', to, payload }))
  }

  private forgetPeer(peerId: string, notify = true) {
    const link = this.links.get(peerId)
    if (!link) {
      if (notify) this.opts.onPeerLeft(peerId)
      return
    }
    link.unsubSync?.()
    link.pc.onconnectionstatechange = null
    link.pc.close()
    this.links.delete(peerId)
    this.signalQueue.delete(peerId)
    dropPeerAwareness(this.opts.awareness, peerId)
    this.opts.onRemoteStream(peerId, null)
    if (notify) this.opts.onPeerLeft(peerId)
    this.emitPeers()
    this.refreshStatus()
  }

  private closeAllLinks() {
    for (const peerId of [...this.links.keys()]) this.forgetPeer(peerId)
    this.members.clear()
    this.members.add(this.opts.clientId)
  }

  private emitPeers() {
    const peers: PeerSnapshot[] = []
    for (const link of this.links.values()) {
      peers.push({ id: link.id, name: link.name, status: link.status })
    }
    peers.sort((a, b) => a.name.localeCompare(b.name))
    this.opts.onPeers(peers)
  }

  private refreshStatus() {
    const links = [...this.links.values()]
    if (links.some((link) => link.status === 'connected')) this.opts.onStatus('Connected')
    else if (links.length > 0) this.opts.onStatus('Connecting to peers…')
    else if (this.ws?.readyState === WebSocket.OPEN) this.opts.onStatus('Waiting for someone to join')
  }
}

export function captureMicrophone(): {
  first: Promise<{ stream: MediaStream | null; error: string }>
  later: Promise<MediaStream | null>
} {
  let resolveLater: (stream: MediaStream | null) => void = () => {}
  const later = new Promise<MediaStream | null>((resolve) => {
    resolveLater = resolve
  })
  const first = new Promise<{ stream: MediaStream | null; error: string }>((resolve) => {
    let settled = false
    const finish = (value: { stream: MediaStream | null; error: string }) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    const timer = window.setTimeout(() => {
      finish({
        stream: null,
        error: 'Allow the microphone in the browser prompt and it will connect. Editing works either way.',
      })
    }, 1200)
    navigator.mediaDevices
      .getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      })
      .then((stream) => {
        window.clearTimeout(timer)
        if (settled) resolveLater(stream)
        else {
          finish({ stream, error: '' })
          resolveLater(null)
        }
      })
      .catch(() => {
        window.clearTimeout(timer)
        finish({
          stream: null,
          error: 'Microphone blocked. You can still edit and listen. Enable the mic when you want to be heard.',
        })
        resolveLater(null)
      })
  })
  return { first, later }
}
