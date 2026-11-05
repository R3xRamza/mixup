import { useState } from 'react'
import type { Track } from '../sync/doc'
import { ROW_H } from './metrics'

type Props = {
  tracks: Track[]
  onRename: (id: string, name: string) => void
  onVolume: (id: string, volume: number) => void
  onMute: (id: string) => void
  onDelete: (id: string) => void
}

export function TrackList({ tracks, onRename, onVolume, onMute, onDelete }: Props) {
  return (
    <>
      {tracks.map((track) => (
        <TrackRow
          key={track.id}
          track={track}
          onRename={onRename}
          onVolume={onVolume}
          onMute={onMute}
          onDelete={onDelete}
        />
      ))}
      {tracks.length === 0 ? <p className="empty-tracks">No tracks yet.</p> : null}
    </>
  )
}

function TrackRow({
  track,
  onRename,
  onVolume,
  onMute,
  onDelete,
}: {
  track: Track
  onRename: (id: string, name: string) => void
  onVolume: (id: string, volume: number) => void
  onMute: (id: string) => void
  onDelete: (id: string) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <div className="track" style={{ height: ROW_H }}>
      <div className="track-top">
        <input
          className="track-name"
          value={draft ?? track.name}
          aria-label="Track name"
          onFocus={() => setDraft(track.name)}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={(event) => {
            onRename(track.id, event.currentTarget.value)
            setDraft(null)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
        />
        <button
          type="button"
          className={track.mute ? 'tiny on' : 'tiny'}
          aria-pressed={track.mute}
          aria-label={track.mute ? 'Unmute track' : 'Mute track'}
          onClick={() => onMute(track.id)}
        >
          {track.mute ? 'Muted' : 'Mute'}
        </button>
        <button type="button" className="tiny danger" aria-label={`Delete ${track.name}`} onClick={() => onDelete(track.id)}>
          ×
        </button>
      </div>
      <input
        className="volume"
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={track.volume}
        aria-label={`${track.name} volume`}
        onChange={(event) => onVolume(track.id, Number(event.target.value))}
      />
    </div>
  )
}
