import { useEffect, useRef, useState } from 'react'
import type { StudioController, StudioSnapshot } from '../studio/controller'
import { formatTime } from './format'
import { RULER_H } from './metrics'
import { Peers } from './Peers'
import { Timeline } from './Timeline'
import { TrackList } from './TrackList'

type Props = {
  controller: StudioController
  snap: StudioSnapshot
  onLeave: () => void
}

export function Studio({ controller, snap, onLeave }: Props) {
  const [pps, setPps] = useState(96)
  const ppsRef = useRef(pps)
  const timeRef = useRef<HTMLSpanElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)
  const headersRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  ppsRef.current = pps

  useEffect(() => {
    let frame = 0
    const tick = () => {
      const position = controller.positionNow()
      if (timeRef.current) timeRef.current.textContent = formatTime(position)
      if (playheadRef.current) {
        playheadRef.current.style.transform = `translateX(${position * ppsRef.current}px)`
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [controller])

  const importFiles = (files: File[]) => {
    void controller.importFiles(files)
  }

  return (
    <div className="app">
      {snap.remoteAudio.map((item) => (
        <RemoteAudio key={item.id} stream={item.stream} />
      ))}
      <header className="topbar">
        <div className="brand">
          <span className="mark" aria-hidden="true" />
          Mixup
        </div>
        <div className="transport">
          <button
            type="button"
            className={snap.playing ? 'play on' : 'play'}
            onClick={() => controller.togglePlay()}
            aria-label={snap.playing ? 'Stop' : 'Play'}
          >
            {snap.playing ? <StopIcon /> : <PlayIcon />}
          </button>
          <span className="time-readout" ref={timeRef}>
            {formatTime(controller.positionNow())}
          </span>
          <button type="button" className="text-btn" onClick={() => controller.splitSelected()} disabled={!snap.selectedClipId}>
            Split
          </button>
          <button type="button" className="text-btn" onClick={() => controller.removeSelected()} disabled={!snap.selectedClipId}>
            Delete
          </button>
          <button type="button" className="text-btn" onClick={() => fileRef.current?.click()}>
            Import
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="audio/*,.wav,.mp3,.ogg,.flac,.m4a,.aac,.aiff"
            multiple
            hidden
            onChange={(event) => {
              const files = event.target.files ? [...event.target.files] : []
              event.target.value = ''
              importFiles(files)
            }}
          />
        </div>
        <label className="zoom">
          Zoom
          <input
            type="range"
            min={32}
            max={280}
            value={pps}
            onChange={(event) => setPps(Number(event.target.value))}
            aria-label="Timeline zoom"
          />
        </label>
        <div className="room-box">
          <span className="status-dot" data-state={snap.status === 'Connected' ? 'on' : 'wait'} />
          <span className="room-code">{snap.roomId}</span>
          <button type="button" className="text-btn" onClick={() => void controller.copyLink()}>
            {snap.linkCopied ? 'Copied' : 'Copy link'}
          </button>
          <button type="button" className="text-btn" onClick={onLeave}>
            Leave
          </button>
        </div>
      </header>
      {snap.banner ? (
        <div className="banner" role="status">
          <span>{snap.banner}</span>
          <button type="button" onClick={() => controller.dismissBanner()} aria-label="Dismiss">
            ×
          </button>
        </div>
      ) : null}
      {!snap.ready ? (
        <div className="booting">Opening the session…</div>
      ) : (
        <div className="workspace">
          <div className="left-col">
            <div className="corner" style={{ height: RULER_H }}>
              Tracks
            </div>
            <div className="tracklist" ref={headersRef}>
              <TrackList
                tracks={snap.tracks}
                onRename={(id, name) => controller.renameTrack(id, name)}
                onVolume={(id, volume) => controller.setVolume(id, volume)}
                onMute={(id) => controller.toggleMute(id)}
                onDelete={(id) => controller.removeTrack(id)}
              />
            </div>
            <button type="button" className="add-track" onClick={() => controller.addTrack()}>
              Add track
            </button>
          </div>
          <Timeline
            tracks={snap.tracks}
            clips={snap.clips}
            assets={snap.assets}
            peaks={snap.peaks}
            missing={new Set(snap.missing)}
            pps={pps}
            selectedClipId={snap.selectedClipId}
            presence={snap.presence}
            playheadRef={playheadRef}
            headersRef={headersRef}
            onSelect={(id) => controller.select(id)}
            onCommit={(clip) => controller.commitClip(clip)}
            onSeek={(sec) => controller.seek(sec)}
            onCursor={(sec) => controller.setCursor(sec)}
            onImport={importFiles}
          />
          <Peers snap={snap} stream={controller.localStream} onToggleMic={() => void controller.toggleMic()} />
        </div>
      )}
    </div>
  )
}

function RemoteAudio({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    element.srcObject = stream
    void element.play().catch(() => {})
    return () => {
      element.srcObject = null
    }
  }, [stream])
  return <audio ref={ref} autoPlay playsInline />
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 2.5v11l10-5.5L4 2.5z" fill="currentColor" />
    </svg>
  )
}

function StopIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3.5" y="3.5" width="9" height="9" fill="currentColor" />
    </svg>
  )
}
