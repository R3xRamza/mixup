import { useEffect, useState, useSyncExternalStore } from 'react'
import { loadClientId, prepareAudio, StudioController } from './studio/controller'
import { Lobby } from './ui/Lobby'
import { Studio } from './ui/Studio'

type Join = {
  roomId: string
  name: string
  clientId: string
  ctx: AudioContext
  stream: MediaStream | null
  micError: string
  micLater: Promise<MediaStream | null>
}

export function App() {
  const [clientId] = useState(loadClientId)
  const [join, setJoin] = useState<Join | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const initialRoom = new URLSearchParams(window.location.search).get('room') ?? ''
  const initialName = sessionStorage.getItem('mixup-name') ?? ''

  if (join) {
    return (
      <StudioSession
        join={join}
        onLeave={() => {
          join.ctx.close().catch(() => {})
          setJoin(null)
        }}
      />
    )
  }

  return (
    <Lobby
      initialRoom={initialRoom}
      initialName={initialName}
      busy={busy}
      error={error}
      onJoin={(roomId, name) => {
        setBusy(true)
        setError('')
        sessionStorage.setItem('mixup-name', name)
        void prepareAudio()
          .then((audio) => {
            setBusy(false)
            setJoin({ roomId, name, clientId, ...audio })
          })
          .catch(() => {
            setError('Audio could not start in this browser.')
            setBusy(false)
          })
      }}
    />
  )
}

function StudioSession({ join, onLeave }: { join: Join; onLeave: () => void }) {
  const [controller] = useState(
    () =>
      new StudioController({
        roomId: join.roomId,
        name: join.name,
        clientId: join.clientId,
        ctx: join.ctx,
        stream: join.stream,
        micError: join.micError,
        micLater: join.micLater,
      }),
  )
  const snap = useSyncExternalStore(
    (listener) => controller.subscribe(listener),
    () => controller.snapshot(),
  )

  useEffect(() => {
    controller.start()
    const url = new URL(window.location.href)
    url.searchParams.set('room', join.roomId)
    window.history.replaceState(null, '', `${url.pathname}?${url.searchParams.toString()}`)
    document.title = `Mixup — ${join.roomId}`
    const unlock = () => {
      void join.ctx.resume()
      document.querySelectorAll('audio').forEach((element) => {
        void (element as HTMLAudioElement).play().catch(() => {})
      })
    }
    window.addEventListener('pointerdown', unlock)
    return () => {
      window.removeEventListener('pointerdown', unlock)
      controller.destroy()
      document.title = 'Mixup'
    }
  }, [controller, join])

  return <Studio controller={controller} snap={snap} onLeave={onLeave} />
}
