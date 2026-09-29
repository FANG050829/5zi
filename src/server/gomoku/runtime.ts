// Serverless 运行时编排：房间加载/心跳合并/AI 落子调度/终局上报
//
// 并发模型（Serverless 多实例下无共享内存、无原子 CAS）：
// - 房间状态 blob 只由「动作请求」写入（落子/聊天/悔棋等用户主动行为，频率低、冲突窗口极小）；
// - 轮询只写独立的轻量心跳记录（hb:code），即使被覆盖也只是丢一次心跳，无实害；
// - 轮询在惰性 tick 触发终局/状态迁移时才回写房间（如超时判负，事件本身罕见）。

import * as engine from './engine'
import type { Color, Room, Seat } from './engine'
import { llmChooseMove } from './llm'
import { roomStore } from './store'
import { createMatch } from '@/server/match-store'

/** 心跳记录：房间内各 pid 最近活跃时间（独立于房间状态，可安全覆盖写） */
interface HbRecord {
  pids: Record<string, number>
}

const memoryHb = new Map<string, HbRecord>()

const onBlobs = () => !!(process.env.NETLIFY === 'true' || process.env.NETLIFY_BLOBS_CONTEXT)

async function readHb(code: string): Promise<HbRecord> {
  if (onBlobs()) {
    try {
      const { getStore } = await import('@netlify/blobs')
      const store = getStore({ name: 'gomoku-meta', consistency: 'strong' })
      return ((await store.get(`hb:${code}`, { type: 'json' })) as HbRecord | null) ?? { pids: {} }
    } catch {
      return { pids: {} }
    }
  }
  return memoryHb.get(code) ?? { pids: {} }
}

async function writeHb(code: string, pid: string): Promise<void> {
  if (onBlobs()) {
    try {
      const { getStore } = await import('@netlify/blobs')
      const store = getStore({ name: 'gomoku-meta', consistency: 'strong' })
      const prev = ((await store.get(`hb:${code}`, { type: 'json' })) as HbRecord | null) ?? { pids: {} }
      prev.pids[pid] = Date.now()
      await store.setJSON(`hb:${code}`, prev)
    } catch {
      /* 心跳失败不影响对局 */
    }
    return
  }
  const rec = memoryHb.get(code) ?? { pids: {} }
  rec.pids[pid] = Date.now()
  memoryHb.set(code, rec)
}

/** 把心跳记录合并进房间内存副本（不落盘）：驱动座位在线状态 */
function mergeHeartbeats(room: Room, hb: HbRecord) {
  for (const key of ['black', 'white'] as const) {
    const seat = room.seats[key]
    if (!seat || seat.isAI) continue
    const ts = hb.pids[seat.playerId]
    if (ts && ts > seat.lastSeen) seat.lastSeen = ts
  }
}

export async function loadRoom(code: string): Promise<Room | null> {
  if (!code) return null
  return roomStore.get(code)
}

export async function saveRoom(room: Room): Promise<void> {
  await roomStore.set(room)
}

export function seatOf(room: Room, pid: string): Seat | null {
  if (!pid) return null
  if (room.seats.black?.playerId === pid) return room.seats.black
  if (room.seats.white?.playerId === pid) return room.seats.white
  return null
}

export function colorOf(room: Room, pid: string): Color | null {
  if (!pid) return null
  if (room.seats.black?.playerId === pid) return 1
  if (room.seats.white?.playerId === pid) return 2
  return null
}

/** 轮询入口：读房间 + 合并心跳 + 惰性 tick；有状态迁移则回写。返回最新公共状态 */
export async function pollRoomState(code: string, pid: string, name: string) {
  const room = await loadFreshRoom(code, pid)
  if (!room) return null
  let changed = false
  if (pid) changed = engine.touchSeat(room, pid) || changed
  changed = engine.tickRoom(room) || changed
  if (changed) {
    await finalizeMatch(room)
    await saveRoom(room)
  }
  // 修正昵称（老玩家改名回归）
  const seat = seatOf(room, pid)
  if (seat && !seat.isAI && name && seat.name !== name) {
    seat.name = name
    await saveRoom(room)
  }
  return engine.publicState(room)
}

/** 动作入口：读房间并合并心跳（写库交给动作本身），附带头跳上报 */
export async function loadFreshRoom(code: string, pid?: string): Promise<Room | null> {
  const room = await loadRoom(code)
  if (!room) return null
  const hb = await readHb(code)
  if (pid) {
    hb.pids[pid] = Date.now()
    await writeHb(code, pid)
  }
  mergeHeartbeats(room, hb)
  return room
}

/**
 * AI 落子调度（同步执行，替代原 setTimeout 排程）：
 * 自定义 LLM 优先，失败/超时回退内置启发式引擎，保证人机对局永不卡死。
 */
export async function ensureAIMove(room: Room): Promise<void> {
  for (let guard = 0; guard < 5; guard++) {
    if (room.status !== 'playing') return
    const seat = room.turn === 1 ? room.seats.black : room.seats.white
    if (!seat?.isAI) return
    let idx = -1
    if (room.aiConfig) {
      try {
        idx = await llmChooseMove(room, room.aiConfig)
      } catch {
        idx = -1
      }
    }
    if (idx < 0) idx = engine.aiChooseMove(room)
    if (idx < 0 || !engine.applyMove(room, idx)) return
  }
}

/** 终局上报战绩（幂等：room.reported 防重复；须在 saveRoom 之前调用） */
export async function finalizeMatch(room: Room): Promise<void> {
  if (room.status !== 'ended' || room.reported) return
  const { black, white } = room.seats
  if (!black || !white) return
  room.reported = true // 先置位再上报，避免并发/重试导致重复入库
  try {
    await createMatch({
      roomCode: room.code,
      blackName: black.name,
      whiteName: white.name,
      blackPid: black.playerId,
      whitePid: white.playerId,
      winnerColor: room.winner ?? 0,
      endReason: room.endReason || 'five',
      moveCount: room.moves.length,
      durationMs: room.startedAt ? Date.now() - room.startedAt : 0,
      mode: room.mode,
      difficulty: room.mode === 'solo' ? room.difficulty : '',
      moves: room.moves.map((m) => `${m.index},${m.color}`).join(';'),
      evals: room.evals.map((v) => Math.round(v * 100)).join(','),
    })
  } catch {
    // 上报失败不阻塞对局
  }
}
