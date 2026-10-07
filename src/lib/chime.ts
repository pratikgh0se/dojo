// A soft two-note chime (WebAudio) at each focus/break switch. Never throws: no audio, no chime.
type AudioCtor = typeof AudioContext
let ctx: AudioContext | null = null

/**
 * Create and resume the AudioContext inside a user gesture (the Start click), so the browser's autoplay
 * policy lets the chime sound later, when a block ends with nobody touching the page.
 */
export function primeChime(): boolean {
  try {
    const Ctor: AudioCtor | undefined = globalThis.AudioContext ?? (globalThis as { webkitAudioContext?: AudioCtor }).webkitAudioContext
    if (!Ctor) return false
    ctx ??= new Ctor()
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
    return true
  } catch {
    return false
  }
}

export function playChime(): boolean {
  try {
    if (!primeChime() || !ctx) return false
    const t = ctx.currentTime
    ;[660, 880].forEach((hz, i) => {
      const osc = ctx!.createOscillator()
      const gain = ctx!.createGain()
      osc.type = 'sine'
      osc.frequency.value = hz
      gain.gain.setValueAtTime(0.0001, t + i * 0.22)
      gain.gain.exponentialRampToValueAtTime(0.12, t + i * 0.22 + 0.03)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.22 + 0.7)
      osc.connect(gain).connect(ctx!.destination)
      osc.start(t + i * 0.22)
      osc.stop(t + i * 0.22 + 0.75)
    })
    return true
  } catch {
    return false
  }
}
