import assert from 'node:assert/strict'
import test from 'node:test'
import {
  LIMITS,
  MessageBudget,
  originAllowed,
  parseAllowedOrigins,
  parseClientMessage,
  sanitizeName,
} from './protocol.ts'

const ID_A = '11111111-1111-4111-8111-111111111111'
const ID_B = '22222222-2222-4222-8222-222222222222'

test('sanitizeName strips control characters and falls back', () => {
  assert.equal(sanitizeName('  Ada\nBee\u202E  '), 'Ada Bee')
  assert.equal(sanitizeName('   '), 'Guest')
  assert.equal(sanitizeName(12), 'Guest')
  assert.equal(sanitizeName('x'.repeat(80)).length, LIMITS.maxName)
})

test('join accepts a normal room and rejects guesses and bad ids', () => {
  const ok = parseClientMessage(JSON.stringify({ type: 'join', roomId: 'AbC-12', clientId: ID_A, name: 'Ada' }))
  assert.equal(ok.ok, true)
  if (ok.ok) {
    assert.equal(ok.message.type, 'join')
    if (ok.message.type === 'join') {
      assert.equal(ok.message.roomId, 'abc-12')
      assert.equal(ok.message.name, 'Ada')
    }
  }
  assert.equal(parseClientMessage(JSON.stringify({ type: 'join', roomId: 'ab', clientId: ID_A })).ok, false)
  assert.equal(parseClientMessage(JSON.stringify({ type: 'join', roomId: 'room!', clientId: ID_A })).ok, false)
  assert.equal(parseClientMessage(JSON.stringify({ type: 'join', roomId: 'room-1', clientId: 'nope' })).ok, false)
})

test('signal keeps only offer, answer, ice, and restart shapes', () => {
  const offer = parseClientMessage(
    JSON.stringify({
      type: 'signal',
      to: ID_B,
      payload: { kind: 'offer', sdp: { type: 'offer', sdp: 'v=0' }, extra: 'nope' },
    }),
  )
  assert.equal(offer.ok, true)
  if (offer.ok && offer.message.type === 'signal' && offer.message.payload.kind === 'offer') {
    assert.deepEqual(offer.message.payload, { kind: 'offer', sdp: { type: 'offer', sdp: 'v=0' } })
  }
  assert.equal(
    parseClientMessage(JSON.stringify({ type: 'signal', to: ID_B, payload: { kind: 'restart' } })).ok,
    true,
  )
  assert.equal(
    parseClientMessage(
      JSON.stringify({ type: 'signal', to: ID_B, payload: { kind: 'offer', sdp: { type: 'answer', sdp: 'v=0' } } }),
    ).ok,
    false,
  )
  assert.equal(
    parseClientMessage(
      JSON.stringify({ type: 'signal', to: ID_B, payload: { kind: 'ice', candidate: { candidate: 'x'.repeat(3000) } } }),
    ).ok,
    false,
  )
})

test('oversized and unknown messages are rejected', () => {
  assert.equal(parseClientMessage('not-json').ok, false)
  assert.equal(parseClientMessage(JSON.stringify({ type: 'exec', cmd: 'rm' })).ok, false)
  assert.equal(parseClientMessage('x'.repeat(LIMITS.maxMessageBytes + 1)).ok, false)
})

test('origin allow list is exact and optional', () => {
  assert.equal(originAllowed('http://evil.test', null), true)
  assert.equal(originAllowed(undefined, ['http://localhost:5173']), false)
  assert.equal(originAllowed('http://localhost:5173', ['http://localhost:5173']), true)
  assert.equal(originAllowed('http://localhost:5174', ['http://localhost:5173']), false)
  assert.deepEqual(parseAllowedOrigins(' http://localhost:5173, https://mixup.example '), [
    'http://localhost:5173',
    'https://mixup.example',
  ])
  assert.equal(parseAllowedOrigins('   '), null)
})

test('message budget closes the window after the cap', () => {
  const budget = new MessageBudget(3, 10_000)
  assert.equal(budget.allow(0), true)
  assert.equal(budget.allow(1), true)
  assert.equal(budget.allow(2), true)
  assert.equal(budget.allow(3), false)
  assert.equal(budget.allow(10_001), true)
})
