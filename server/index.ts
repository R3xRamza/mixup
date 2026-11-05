import { createServer, type IncomingMessage } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import {
  LIMITS,
  MessageBudget,
  originAllowed,
  parseAllowedOrigins,
  parseClientMessage,
} from './protocol.js'

const PORT = Number(process.env.PORT) || 8787
const allowedOrigins = parseAllowedOrigins(process.env.MIXUP_ALLOWED_ORIGINS)

type Member = { ws: WebSocket; id: string; name: string }

const rooms = new Map<string, Map<string, Member>>()
const connectionsByIp = new Map<string, number>()

function securityHeaders(): Record<string, string> {
  return {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
  }
}

function clientIp(request: IncomingMessage): string {
  if (process.env.MIXUP_TRUST_PROXY === '1') {
    const forwarded = request.headers['x-forwarded-for']
    if (typeof forwarded === 'string' && forwarded.length < 200) {
      const first = forwarded.split(',')[0]?.trim()
      if (first) return first
    }
  }
  return request.socket.remoteAddress ?? 'unknown'
}

function changeIpCount(ip: string, delta: number) {
  const next = (connectionsByIp.get(ip) ?? 0) + delta
  if (next <= 0) connectionsByIp.delete(ip)
  else connectionsByIp.set(ip, next)
}

function leaderId(members: Map<string, Member>): string {
  return [...members.keys()].sort()[0] ?? ''
}

function broadcast(members: Map<string, Member>, payload: unknown, exceptId?: string) {
  const data = JSON.stringify(payload)
  for (const member of members.values()) {
    if (member.id === exceptId) continue
    if (member.ws.readyState === member.ws.OPEN) member.ws.send(data)
  }
}

function send(ws: WebSocket, payload: unknown) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload))
}

const httpServer = createServer((request, response) => {
  const path = request.url?.split('?')[0]
  if (path === '/health') {
    response.writeHead(200, securityHeaders())
    response.end('ok\n')
    return
  }
  response.writeHead(200, securityHeaders())
  response.end('mixup signaling\n')
})

const wss = new WebSocketServer({
  server: httpServer,
  maxPayload: LIMITS.maxMessageBytes,
  perMessageDeflate: false,
})

wss.on('connection', (ws, request) => {
  ws.on('error', () => {})
  const originHeader = request.headers.origin
  const origin = typeof originHeader === 'string' ? originHeader : undefined
  if (!originAllowed(origin, allowedOrigins)) {
    ws.close(1008, 'origin')
    return
  }

  const ip = clientIp(request)
  if ((connectionsByIp.get(ip) ?? 0) >= LIMITS.maxConnectionsPerIp) {
    ws.close(1008, 'too many connections')
    return
  }
  changeIpCount(ip, 1)

  let roomId = ''
  let clientId = ''
  let violations = 0
  const budget = new MessageBudget()
  const alive = ws as WebSocket & { isAlive?: boolean }
  alive.isAlive = true
  ws.on('pong', () => {
    alive.isAlive = true
  })

  const fail = (error: string) => {
    violations += 1
    send(ws, { type: 'error', message: error })
    if (violations >= LIMITS.violationsBeforeClose) ws.close(1008, 'protocol')
  }

  ws.on('message', (raw, isBinary) => {
    if (isBinary) {
      ws.close(1003, 'text only')
      return
    }
    const text = raw.toString()
    if (!budget.allow(Date.now())) {
      ws.close(1008, 'rate limit')
      return
    }
    const parsed = parseClientMessage(text)
    if (!parsed.ok) {
      fail(parsed.error)
      return
    }
    const message = parsed.message

    if (message.type === 'join') {
      if (roomId && clientId) leave(ws, roomId, clientId)

      if (!rooms.has(message.roomId) && rooms.size >= LIMITS.maxRooms) {
        fail('The server is at room capacity.')
        return
      }
      const members = rooms.get(message.roomId) ?? new Map<string, Member>()
      if (members.size >= LIMITS.maxPeers && !members.has(message.clientId)) {
        roomId = ''
        clientId = ''
        send(ws, { type: 'error', message: 'This room is full (4 people).' })
        return
      }

      const previous = members.get(message.clientId)
      if (previous && previous.ws !== ws) previous.ws.close()

      const isHost = members.size === 0 || (members.size === 1 && members.has(message.clientId))
      const peers = [...members.values()]
        .filter((member) => member.id !== message.clientId)
        .map((member) => ({ clientId: member.id, name: member.name }))

      roomId = message.roomId
      clientId = message.clientId
      members.set(clientId, { ws, id: clientId, name: message.name })
      rooms.set(roomId, members)
      const leader = leaderId(members)
      send(ws, { type: 'joined', isHost, clientId, leaderId: leader, peers })
      broadcast(members, { type: 'peer-joined', clientId, name: message.name }, clientId)
      broadcast(members, { type: 'leader', leaderId: leader })
      return
    }

    if (!roomId || !clientId || message.to === clientId) return
    const target = rooms.get(roomId)?.get(message.to)
    if (target && target.ws.readyState === target.ws.OPEN) {
      send(target.ws, { type: 'signal', from: clientId, payload: message.payload })
    }
  })

  ws.on('close', () => {
    changeIpCount(ip, -1)
    if (roomId && clientId) leave(ws, roomId, clientId)
  })
})

function leave(ws: WebSocket, roomId: string, clientId: string) {
  const members = rooms.get(roomId)
  const current = members?.get(clientId)
  if (!members || !current || current.ws !== ws) return
  members.delete(clientId)
  if (members.size === 0) {
    rooms.delete(roomId)
    return
  }
  broadcast(members, { type: 'peer-left', clientId })
  broadcast(members, { type: 'leader', leaderId: leaderId(members) })
}

const heartbeat = setInterval(() => {
  for (const client of wss.clients) {
    const socket = client as WebSocket & { isAlive?: boolean }
    if (socket.isAlive === false) {
      socket.terminate()
      continue
    }
    socket.isAlive = false
    socket.ping()
  }
}, 30_000)
heartbeat.unref()

httpServer.on('error', (error) => {
  console.error(error)
  process.exit(1)
})

httpServer.listen(PORT, () => {
  const originNote = allowedOrigins ? `origins ${allowedOrigins.join(', ')}` : 'any origin'
  console.log(`mixup signaling on ws://localhost:${PORT} (${originNote})`)
})
