// 极简音效：WebAudio 合成，无需素材文件
// playStone 落子 / playCapture 胜利 / playFail 失败 / playNotify 提示

let ctx: AudioContext | null = null
let muted = false
let mutedLoaded = false

const mutedListeners = new Set<() => void>()

function ensureMutedLoaded() {
  if (mutedLoaded) return
  mutedLoaded = true
  try {
    muted = localStorage.getItem('gomoku-muted') === '1'
  } catch {}
}

/** 供 useSyncExternalStore 订阅静音状态 */
export function subscribeMuted(cb: () => void): () => void {
  mutedListeners.add(cb)
  return () => mutedListeners.delete(cb)
}
export function getMutedSnapshot(): boolean {
  ensureMutedLoaded()
  return muted
}
export function getMutedServerSnapshot(): boolean {
  return false
}
export function setMuted(v: boolean) {
  muted = v
  try {
    localStorage.setItem('gomoku-muted', v ? '1' : '0')
  } catch {}
  mutedListeners.forEach((l) => l())
}
export function toggleMuted(): boolean {
  ensureMutedLoaded()
  setMuted(!muted)
  return muted
}

function ac(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    ctx = new AC()
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  return ctx
}

/** 落子声：短促的清脆“嗒” */
export function playStone() {
  if (muted) return
  const c = ac()
  if (!c) return
  const t = c.currentTime
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(520, t)
  osc.frequency.exponentialRampToValueAtTime(180, t + 0.08)
  gain.gain.setValueAtTime(0.25, t)
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1)
  osc.connect(gain).connect(c.destination)
  osc.start(t)
  osc.stop(t + 0.12)

  // 一点点噪声模拟击打感
  const buf = c.createBuffer(1, c.sampleRate * 0.03, c.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) * 0.15
  const noise = c.createBufferSource()
  const ng = c.createGain()
  noise.buffer = buf
  ng.gain.value = 0.4
  noise.connect(ng).connect(c.destination)
  noise.start(t)
}

/** 胜利：上行三音 */
export function playWin() {
  if (muted) return
  const c = ac()
  if (!c) return
  ;[523.25, 659.25, 783.99].forEach((f, i) => {
    const t = c.currentTime + i * 0.12
    const osc = c.createOscillator()
    const gain = c.createGain()
    osc.type = 'sine'
    osc.frequency.value = f
    gain.gain.setValueAtTime(0.18, t)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35)
    osc.connect(gain).connect(c.destination)
    osc.start(t)
    osc.stop(t + 0.4)
  })
}

/** 失败：下行两音 */
export function playLose() {
  if (muted) return
  const c = ac()
  if (!c) return
  ;[392, 261.63].forEach((f, i) => {
    const t = c.currentTime + i * 0.16
    const osc = c.createOscillator()
    const gain = c.createGain()
    osc.type = 'sine'
    osc.frequency.value = f
    gain.gain.setValueAtTime(0.15, t)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4)
    osc.connect(gain).connect(c.destination)
    osc.start(t)
    osc.stop(t + 0.45)
  })
}

/** 轻提示（系统消息/请求） */
export function playNotify() {
  if (muted) return
  const c = ac()
  if (!c) return
  const t = c.currentTime
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.type = 'triangle'
  osc.frequency.value = 880
  gain.gain.setValueAtTime(0.08, t)
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15)
  osc.connect(gain).connect(c.destination)
  osc.start(t)
  osc.stop(t + 0.18)
}

/** 聊天消息：双音上行，轻柔（区别于系统提示） */
export function playChat() {
  if (muted) return
  const c = ac()
  if (!c) return
  ;[660, 880].forEach((f, i) => {
    const t = c.currentTime + i * 0.07
    const osc = c.createOscillator()
    const gain = c.createGain()
    osc.type = 'sine'
    osc.frequency.value = f
    gain.gain.setValueAtTime(0.07, t)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14)
    osc.connect(gain).connect(c.destination)
    osc.start(t)
    osc.stop(t + 0.16)
  })
}

/** 悔棋/再战请求：两下轻敲（木质低频） */
export function playKnock() {
  if (muted) return
  const c = ac()
  if (!c) return
  ;[0, 0.13].forEach((off) => {
    const t = c.currentTime + off
    const osc = c.createOscillator()
    const gain = c.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(240, t)
    osc.frequency.exponentialRampToValueAtTime(170, t + 0.09)
    gain.gain.setValueAtTime(0.2, t)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.11)
    osc.connect(gain).connect(c.destination)
    osc.start(t)
    osc.stop(t + 0.12)
  })
}

/** 好友加入/开局：上行两音（明亮） */
export function playJoin() {
  if (muted) return
  const c = ac()
  if (!c) return
  ;[523.25, 783.99].forEach((f, i) => {
    const t = c.currentTime + i * 0.1
    const osc = c.createOscillator()
    const gain = c.createGain()
    osc.type = 'triangle'
    osc.frequency.value = f
    gain.gain.setValueAtTime(0.1, t)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22)
    osc.connect(gain).connect(c.destination)
    osc.start(t)
    osc.stop(t + 0.24)
  })
}

/** 提示揭示：三连快速上行闪音 */
export function playHintChime() {
  if (muted) return
  const c = ac()
  if (!c) return
  ;[880, 1174.66, 1567.98].forEach((f, i) => {
    const t = c.currentTime + i * 0.055
    const osc = c.createOscillator()
    const gain = c.createGain()
    osc.type = 'sine'
    osc.frequency.value = f
    gain.gain.setValueAtTime(0.09, t)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12)
    osc.connect(gain).connect(c.destination)
    osc.start(t)
    osc.stop(t + 0.14)
  })
}

/** 倒计时嘟味（≤5 秒每秒一次） */
export function playTick() {
  if (muted) return
  const c = ac()
  if (!c) return
  const t = c.currentTime
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.type = 'square'
  osc.frequency.value = 1046.5
  gain.gain.setValueAtTime(0.05, t)
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06)
  osc.connect(gain).connect(c.destination)
  osc.start(t)
  osc.stop(t + 0.07)
}
