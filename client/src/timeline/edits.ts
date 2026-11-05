import type { Clip } from '../sync/doc'

const MIN_DURATION = 0.05

function roundSec(value: number): number {
  return Math.round(value * 1000) / 1000
}

export function movedClip(origin: Clip, deltaSec: number, trackId: string): Clip {
  return {
    ...origin,
    trackId,
    startSec: roundSec(Math.max(0, origin.startSec + deltaSec)),
  }
}

export function trimmedLeft(origin: Clip, deltaSec: number): Clip {
  const minDelta = Math.max(-origin.offsetSec, -origin.startSec)
  const maxDelta = origin.durationSec - MIN_DURATION
  const delta = Math.min(maxDelta, Math.max(minDelta, deltaSec))
  return {
    ...origin,
    startSec: roundSec(origin.startSec + delta),
    offsetSec: roundSec(origin.offsetSec + delta),
    durationSec: roundSec(origin.durationSec - delta),
  }
}

export function trimmedRight(origin: Clip, deltaSec: number, assetDuration: number): Clip {
  const maxDuration = Math.max(MIN_DURATION, assetDuration - origin.offsetSec)
  const duration = Math.min(maxDuration, Math.max(MIN_DURATION, origin.durationSec + deltaSec))
  return { ...origin, durationSec: roundSec(duration) }
}

export function splitClip(origin: Clip, atSec: number): { left: Clip; right: Clip } | null {
  const into = atSec - origin.startSec
  if (into < MIN_DURATION || origin.durationSec - into < MIN_DURATION) return null
  return {
    left: { ...origin, durationSec: roundSec(into) },
    right: {
      ...origin,
      id: crypto.randomUUID(),
      startSec: roundSec(atSec),
      offsetSec: roundSec(origin.offsetSec + into),
      durationSec: roundSec(origin.durationSec - into),
    },
  }
}
