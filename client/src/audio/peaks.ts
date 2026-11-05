export type Peaks = {
  mins: Float32Array
  maxs: Float32Array
}

export function computePeaks(buffer: AudioBuffer, buckets = 1800): Peaks {
  const channels: Float32Array[] = []
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    channels.push(buffer.getChannelData(channel))
  }
  const length = buffer.length
  const count = Math.max(1, Math.min(buckets, length))
  const mins = new Float32Array(count)
  const maxs = new Float32Array(count)
  const samplesPerBucket = length / count
  for (let bucket = 0; bucket < count; bucket += 1) {
    const start = Math.floor(bucket * samplesPerBucket)
    const end = Math.max(start + 1, Math.min(length, Math.floor((bucket + 1) * samplesPerBucket)))
    let min = 1
    let max = -1
    for (let index = start; index < end; index += 1) {
      let sample = 0
      for (let channel = 0; channel < channels.length; channel += 1) sample += channels[channel][index]
      sample /= channels.length
      if (sample < min) min = sample
      if (sample > max) max = sample
    }
    mins[bucket] = min
    maxs[bucket] = max
  }
  return { mins, maxs }
}
