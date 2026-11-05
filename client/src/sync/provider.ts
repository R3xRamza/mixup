import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as syncProtocol from 'y-protocols/sync'
import * as Y from 'yjs'

const messageSync = 0
const messageAwareness = 1

function send(channel: RTCDataChannel, bytes: Uint8Array) {
  if (channel.readyState === 'open') channel.send(bytes as Uint8Array<ArrayBuffer>)
}

export function bindSyncChannel(
  doc: Y.Doc,
  awareness: awarenessProtocol.Awareness,
  channel: RTCDataChannel,
  peerId: string,
): () => void {
  const origin = `peer:${peerId}`
  channel.binaryType = 'arraybuffer'

  const onDocUpdate = (update: Uint8Array, updateOrigin: unknown) => {
    if (updateOrigin === origin) return
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, messageSync)
    syncProtocol.writeUpdate(encoder, update)
    send(channel, encoding.toUint8Array(encoder))
  }

  const onAwareness = (
    change: { added: number[]; updated: number[]; removed: number[] },
    awarenessOrigin: unknown,
  ) => {
    if (awarenessOrigin === origin) return
    const changed = change.added.concat(change.updated, change.removed)
    if (changed.length === 0) return
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, messageAwareness)
    encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(awareness, changed))
    send(channel, encoding.toUint8Array(encoder))
  }

  const startHandshake = () => {
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, messageSync)
    syncProtocol.writeSyncStep1(encoder, doc)
    send(channel, encoding.toUint8Array(encoder))

    const ids = Array.from(awareness.getStates().keys())
    if (ids.length > 0) {
      const awarenessEncoder = encoding.createEncoder()
      encoding.writeVarUint(awarenessEncoder, messageAwareness)
      encoding.writeVarUint8Array(
        awarenessEncoder,
        awarenessProtocol.encodeAwarenessUpdate(awareness, ids),
      )
      send(channel, encoding.toUint8Array(awarenessEncoder))
    }
  }

  channel.onmessage = (event: MessageEvent) => {
    try {
      const data = new Uint8Array(event.data as ArrayBuffer)
      const decoder = decoding.createDecoder(data)
      const type = decoding.readVarUint(decoder)
      if (type === messageSync) {
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, messageSync)
        syncProtocol.readSyncMessage(decoder, encoder, doc, origin)
        if (encoding.length(encoder) > 1) send(channel, encoding.toUint8Array(encoder))
      } else if (type === messageAwareness) {
        awarenessProtocol.applyAwarenessUpdate(awareness, decoding.readVarUint8Array(decoder), origin)
      }
    } catch (error) {
      console.error('sync channel', error)
    }
  }

  doc.on('update', onDocUpdate)
  awareness.on('update', onAwareness)
  if (channel.readyState === 'open') startHandshake()
  else channel.addEventListener('open', startHandshake, { once: true })

  return () => {
    doc.off('update', onDocUpdate)
    awareness.off('update', onAwareness)
  }
}

export function dropPeerAwareness(awareness: awarenessProtocol.Awareness, peerId: string) {
  const ids: number[] = []
  awareness.getStates().forEach((state, clientId) => {
    if (state && (state as { peerId?: string }).peerId === peerId) ids.push(clientId)
  })
  if (ids.length > 0) awarenessProtocol.removeAwarenessStates(awareness, ids, 'disconnect')
}
