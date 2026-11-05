import { useEffect, useRef } from 'react'
import type { StudioSnapshot } from '../studio/controller'

type Props = {
  snap: StudioSnapshot
  stream: MediaStream | null
  onToggleMic: () => void
}

export function Peers({ snap, stream, onToggleMic }: Props) {
  const meterStream = snap.hasMic && !snap.micMuted ? stream : null
  return (
    <aside className="peers">
      <h2>Session</h2>
      <p className="status-line">{snap.status}</p>
      <p className="clock-line">{snap.clockReady ? 'Timing synced' : 'Syncing timing…'}</p>
      <section className="you">
        <header>
          <span className="swatch" style={{ background: snap.color }} />
          <strong>{snap.name}</strong>
          <em>You</em>
        </header>
        <button type="button" className={snap.micMuted || !snap.hasMic ? 'mic off' : 'mic'} onClick={onToggleMic}>
          {!snap.hasMic ? 'Enable microphone' : snap.micMuted ? 'Mic muted' : 'Mic live'}
        </button>
        <Meter stream={meterStream} />
        {snap.micError ? <p className="mic-error">{snap.micError}</p> : null}
      </section>
      <ul className="peer-list">
        {snap.peers.length === 0 ? <li className="alone">Waiting for someone to open this room.</li> : null}
        {snap.peers.map((peer) => {
          const presence = snap.presence.find((item) => item.clientId === peer.id)
          return (
            <li key={peer.id}>
              <span className="swatch" style={{ background: presence?.color ?? '#8d887c' }} />
              <span className="peer-name">{presence?.name || peer.name}</span>
              <span className="peer-state">{peer.status}</span>
            </li>
          )
        })}
      </ul>
      <p className="hint">Headphones keep the mic from picking the arrangement back up. Speakers will echo.</p>
      <p className="keys">Space play or stop · S split · Delete removes the selected clip</p>
    </aside>
  )
}

function Meter({ stream }: { stream: MediaStream | null }) {
  const barRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const bar = barRef.current
    if (!stream || !bar) {
      if (bar) bar.style.transform = 'scaleX(0)'
      return
    }
    const ctx = new AudioContext()
    const source = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    source.connect(analyser)
    const data = new Uint8Array(analyser.fftSize)
    let frame = 0
    const tick = () => {
      analyser.getByteTimeDomainData(data)
      let sum = 0
      for (let index = 0; index < data.length; index += 1) {
        const sample = (data[index] - 128) / 128
        sum += sample * sample
      }
      const level = Math.min(1, Math.sqrt(sum / data.length) * 3.4)
      bar.style.transform = `scaleX(${level})`
      frame = requestAnimationFrame(tick)
    }
    void ctx.resume().then(() => {
      frame = requestAnimationFrame(tick)
    })
    return () => {
      cancelAnimationFrame(frame)
      source.disconnect()
      void ctx.close()
    }
  }, [stream])
  return (
    <div className="meter" aria-hidden="true">
      <div ref={barRef} className="meter-bar" />
    </div>
  )
}
