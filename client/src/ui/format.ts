export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const minutes = Math.floor(sec / 60)
  const seconds = sec - minutes * 60
  return `${minutes}:${seconds.toFixed(1).padStart(4, '0')}`
}

const CLIP_COLORS = ['#2c6b5e', '#8d6234', '#3c5d86', '#7c4556', '#5d6a3d', '#57497a']

export function clipColor(id: string): string {
  let hash = 0
  for (let index = 0; index < id.length; index += 1) hash = (hash * 33 + id.charCodeAt(index)) >>> 0
  return CLIP_COLORS[hash % CLIP_COLORS.length]
}
