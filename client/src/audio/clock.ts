export class SharedClock {
  offsetMs = 0
  ready = false
  private isLeader = false

  becomeLeader() {
    this.isLeader = true
    this.offsetMs = 0
    this.ready = true
  }

  invalidate() {
    this.isLeader = false
    this.ready = false
    this.offsetMs = 0
  }

  sharedNow(): number {
    return performance.now() + this.offsetMs
  }

  notePong(t0: number, t1: number, t2: number) {
    if (this.isLeader) return
    const rtt = t2 - t0
    if (rtt < 0 || rtt > 1500) return
    const sample = t1 - (t0 + rtt / 2)
    if (!this.ready) {
      this.offsetMs = sample
      this.ready = true
      return
    }
    this.offsetMs = this.offsetMs * 0.8 + sample * 0.2
  }
}

export function sharedToAudioTime(sharedTimeMs: number, offsetMs: number, ctx: AudioContext): number {
  const localPerf = sharedTimeMs - offsetMs
  const delayMs = localPerf - performance.now()
  return ctx.currentTime + delayMs / 1000
}
