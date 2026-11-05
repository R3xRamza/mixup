import { useMemo, useState } from 'react'
import { cleanName, cleanRoom, randomRoom } from '../studio/controller'

type Props = {
  initialRoom: string
  initialName: string
  busy: boolean
  error: string
  onJoin: (roomId: string, name: string) => void
}

export function Lobby({ initialRoom, initialName, busy, error, onJoin }: Props) {
  const [name, setName] = useState(initialName)
  const [room, setRoom] = useState(initialRoom)
  const roomId = useMemo(() => cleanRoom(room), [room])
  const roomReady = roomId.length >= 4

  return (
    <main className="lobby">
      <form
        className="lobby-card"
          onSubmit={(event) => {
          event.preventDefault()
          if (!roomReady || busy) return
          onJoin(roomId, cleanName(name) || 'Guest')
        }}
      >
        <p className="eyebrow">Shared session</p>
        <h1>
          <span className="mark" aria-hidden="true" />
          Mixup
        </h1>
        <p className="lede">Arrange audio together, press play at the same time, and hear each other while you work.</p>
        <label>
          Your name
          <input
            value={name}
            maxLength={32}
            autoComplete="nickname"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          Room code
          <input
            value={room}
            maxLength={32}
            spellCheck={false}
            autoCapitalize="none"
            onChange={(event) => setRoom(event.target.value)}
          />
        </label>
        {room.trim() && !roomReady ? <p className="hint">Room codes need at least 4 characters.</p> : null}
        {error ? <p className="form-error">{error}</p> : null}
        <div className="lobby-actions">
          <button type="submit" className="primary" disabled={!roomReady || busy}>
            {busy ? 'Joining…' : 'Join room'}
          </button>
          <button
            type="button"
            className="ghost"
            disabled={busy}
            onClick={() => {
              const next = randomRoom()
              setRoom(next)
              onJoin(next, cleanName(name) || 'Guest')
            }}
          >
            New room
          </button>
        </div>
      </form>
    </main>
  )
}
