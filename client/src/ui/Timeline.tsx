import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import type { Peaks } from '../audio/peaks'
import type { AssetMeta, Clip, Track } from '../sync/doc'
import type { Presence } from '../studio/controller'
import { movedClip, trimmedLeft, trimmedRight } from '../timeline/edits'
import { clipColor, formatTime } from './format'
import { ROW_H, RULER_H } from './metrics'

type Props = {
  tracks: Track[]
  clips: Clip[]
  assets: AssetMeta[]
  peaks: Map<string, Peaks>
  missing: Set<string>
  pps: number
  selectedClipId: string | null
  presence: Presence[]
  playheadRef: RefObject<HTMLDivElement | null>
  headersRef: RefObject<HTMLDivElement | null>
  onSelect: (id: string | null) => void
  onCommit: (clip: Clip) => void
  onSeek: (sec: number) => void
  onCursor: (sec: number | null) => void
  onImport: (files: File[]) => void
}

type Drag = {
  kind: 'move' | 'trim-left' | 'trim-right'
  pointerX: number
  origin: Clip
}

export function Timeline({
  tracks,
  clips,
  assets,
  peaks,
  missing,
  pps,
  selectedClipId,
  presence,
  playheadRef,
  headersRef,
  onSelect,
  onCommit,
  onSeek,
  onCursor,
  onImport,
}: Props) {
  const [draft, setDraft] = useState<Clip | null>(null)
  const [dropActive, setDropActive] = useState(false)
  const dragRef = useRef<Drag | null>(null)
  const draftRef = useRef<Clip | null>(null)
  const lanesRef = useRef<HTMLDivElement>(null)
  const onCommitRef = useRef(onCommit)
  const ppsRef = useRef(pps)
  const assetsRef = useRef(assets)
  onCommitRef.current = onCommit
  ppsRef.current = pps
  assetsRef.current = assets

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const delta = (event.clientX - drag.pointerX) / ppsRef.current
      const asset = assetsRef.current.find((item) => item.id === drag.origin.assetId)
      const assetDuration = asset?.durationSec ?? drag.origin.offsetSec + drag.origin.durationSec
      let next: Clip
      if (drag.kind === 'move') {
        const trackId = trackFromPoint(lanesRef.current, event.clientY) ?? drag.origin.trackId
        next = movedClip(drag.origin, delta, trackId)
      } else if (drag.kind === 'trim-left') {
        next = trimmedLeft(drag.origin, delta)
      } else {
        next = trimmedRight(drag.origin, delta, assetDuration)
      }
      draftRef.current = next
      setDraft(next)
    }
    const up = () => {
      if (!dragRef.current) return
      dragRef.current = null
      const clip = draftRef.current
      draftRef.current = null
      setDraft(null)
      if (clip) onCommitRef.current(clip)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [])

  const end = clips.reduce((max, clip) => Math.max(max, clip.startSec + clip.durationSec), 0)
  const width = Math.max(30, end + 8) * pps
  const shown = clips.map((clip) => (clip.id === draft?.id ? draft : clip))
  const step = pps >= 140 ? 1 : pps >= 70 ? 2 : pps >= 40 ? 5 : 10
  const marks: number[] = []
  for (let second = 0; second <= width / pps; second += step) marks.push(second)

  const begin = (event: ReactPointerEvent, clip: Clip, kind: Drag['kind']) => {
    event.stopPropagation()
    event.preventDefault()
    dragRef.current = { kind, pointerX: event.clientX, origin: clip }
    draftRef.current = clip
    onSelect(clip.id)
  }

  return (
    <div
      className={dropActive ? 'timeline-scroll dropping' : 'timeline-scroll'}
      onScroll={(event) => {
        if (headersRef.current) headersRef.current.scrollTop = event.currentTarget.scrollTop
      }}
      onDragOver={(event) => {
        event.preventDefault()
        setDropActive(true)
      }}
      onDragLeave={() => setDropActive(false)}
      onDrop={(event) => {
        event.preventDefault()
        setDropActive(false)
        onImport([...event.dataTransfer.files])
      }}
    >
      <div className="timeline-inner" style={{ width }} onPointerLeave={() => onCursor(null)}>
        <div
          className="ruler"
          style={{ height: RULER_H }}
          onPointerDown={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            onSeek(Math.max(0, (event.clientX - rect.left) / pps))
          }}
          onPointerMove={(event) => {
            if (dragRef.current) return
            const rect = event.currentTarget.getBoundingClientRect()
            onCursor(Math.max(0, (event.clientX - rect.left) / pps))
          }}
        >
          {marks.map((second) => (
            <span key={second} className="tick" style={{ left: second * pps }}>
              {formatTime(second)}
            </span>
          ))}
        </div>
        <div
          className="lanes"
          ref={lanesRef}
          onPointerMove={(event) => {
            if (dragRef.current) return
            const rect = event.currentTarget.getBoundingClientRect()
            onCursor(Math.max(0, (event.clientX - rect.left) / pps))
          }}
        >
          {tracks.map((track) => (
            <div
              key={track.id}
              className="lane"
              data-track-id={track.id}
              style={{ height: ROW_H }}
              onPointerDown={() => onSelect(null)}
            >
              {shown
                .filter((clip) => clip.trackId === track.id)
                .map((clip) => {
                  const asset = assets.find((item) => item.id === clip.assetId)
                  const sha = asset?.sha256 ?? ''
                  return (
                    <div
                      key={clip.id}
                      className={clip.id === selectedClipId ? 'clip selected' : 'clip'}
                      style={{
                        left: clip.startSec * pps,
                        width: Math.max(4, clip.durationSec * pps),
                        background: clipColor(clip.assetId),
                      }}
                      onPointerDown={(event) => begin(event, clip, 'move')}
                    >
                      <span className="clip-name">{asset?.name ?? 'Audio'}</span>
                      {asset && missing.has(sha) ? <em className="receiving">Receiving…</em> : null}
                      <Waveform
                        peaks={peaks.get(sha) ?? null}
                        assetDuration={asset?.durationSec ?? clip.durationSec}
                        offset={clip.offsetSec}
                        duration={clip.durationSec}
                      />
                      <div className="handle left" onPointerDown={(event) => begin(event, clip, 'trim-left')} />
                      <div className="handle right" onPointerDown={(event) => begin(event, clip, 'trim-right')} />
                    </div>
                  )
                })}
            </div>
          ))}
          {tracks.length === 0 ? <p className="drop-hint">Add a track, then drop audio here.</p> : null}
          {tracks.length > 0 && clips.length === 0 ? (
            <p className="drop-hint">Drop audio here, or use Import.</p>
          ) : null}
          {presence.map((person) =>
            person.cursorSec == null ? null : (
              <div
                key={person.clientId}
                className="remote-cursor"
                style={{ transform: `translateX(${person.cursorSec * pps}px)`, color: person.color }}
              >
                <span style={{ background: person.color }}>{person.name}</span>
              </div>
            ),
          )}
          <div ref={playheadRef} className="playhead" />
        </div>
      </div>
    </div>
  )
}

function trackFromPoint(lanes: HTMLDivElement | null, clientY: number): string | null {
  if (!lanes) return null
  const nodes = lanes.querySelectorAll<HTMLElement>('[data-track-id]')
  for (const node of nodes) {
    const rect = node.getBoundingClientRect()
    if (clientY >= rect.top && clientY <= rect.bottom) return node.dataset.trackId ?? null
  }
  return null
}

function Waveform({
  peaks,
  assetDuration,
  offset,
  duration,
}: {
  peaks: Peaks | null
  assetDuration: number
  offset: number
  duration: number
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const draw = () => {
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      if (width < 2 || height < 2) return
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, height)
      if (!peaks || assetDuration <= 0) return
      const count = peaks.mins.length
      const start = Math.max(0, Math.min(count - 1, (offset / assetDuration) * count))
      const end = Math.max(start + 1, Math.min(count, ((offset + duration) / assetDuration) * count))
      ctx.fillStyle = 'rgba(236, 232, 220, 0.88)'
      const mid = height / 2
      for (let x = 0; x < width; x += 1) {
        const index = Math.min(count - 1, Math.floor(start + ((x + 0.5) / width) * (end - start)))
        const min = peaks.mins[index]
        const max = peaks.maxs[index]
        const y1 = mid + min * (mid - 1)
        const y2 = mid + max * (mid - 1)
        ctx.fillRect(x, Math.min(y1, y2), 1, Math.max(1, Math.abs(y2 - y1)))
      }
    }
    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [peaks, assetDuration, offset, duration])
  return <canvas ref={ref} className="wave" />
}
