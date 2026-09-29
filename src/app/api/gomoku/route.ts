// 联机五子棋 Serverless API（替代原 socket.io 长连接）：
// GET  /api/gomoku?mode=presence|peek|state —— 在线人数 / 房间预览 / 状态轮询
// POST /api/gomoku { action, ... } —— 建房/加入/落子/悔棋/提示/再战/聊天/弹幕/AI 测试
// AI 走子：solo 房间可携带自定义 OpenAI 兼容模型配置（aiConfig），失败自动回退内置引擎

import { NextRequest, NextResponse } from 'next/server'
import * as eng from '@/server/gomoku/engine'
import type { AiModelConfig } from '@/lib/gomoku/ai-config'
import {
  colorOf,
  ensureAIMove,
  finalizeMatch,
  loadFreshRoom,
  pollRoomState,
  saveRoom,
} from '@/server/gomoku/runtime'
import { testAiConnection } from '@/server/gomoku/llm'
import { allocateRoom, presenceStore, roomStore } from '@/server/gomoku/store'

export const dynamic = 'force-dynamic'

const clampStr = (v: unknown, max: number) => String(v ?? '').slice(0, max)

/** 清洗客户端提交的自定义 AI 配置（密钥只存房间内，绝不回传给其他客户端） */
function sanitizeAiConfig(raw: unknown): AiModelConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const name = clampStr(r.name, 16).replace(/[\u0000-\u001f<>]/g, '').trim() || '自定义AI'
  const baseUrl = clampStr(r.baseUrl, 200).trim()
  const model = clampStr(r.model, 100).trim()
  if (!baseUrl || !model) return null
  return {
    id: clampStr(r.id, 40) || 'ai-llm',
    name,
    baseUrl,
    apiKey: clampStr(r.apiKey, 200),
    model,
    systemPrompt: clampStr(r.systemPrompt, 500),
    temperature: Number.isFinite(Number(r.temperature)) ? Math.max(0, Math.min(2, Number(r.temperature))) : 0.3,
  }
}

const hasCode = async (code: string) => (await roomStore.get(code)) !== null

/** 生成未占用的房号（存储查询为异步，采用生成后校验重试） */
async function newRoomCode(): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const code = eng.genCode(() => false)
    if (!(await hasCode(code))) return code
  }
  return eng.genCode(() => false)
}

// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const mode = sp.get('mode') ?? 'state'

  try {
    if (mode === 'presence') {
      const pid = clampStr(sp.get('pid'), 64)
      const online = await presenceStore.heartbeat(pid || 'anonymous')
      return NextResponse.json({ ok: true, online })
    }

    if (mode === 'peek') {
      const code = clampStr(sp.get('code'), 8).toUpperCase().replace(/[^A-Z0-9]/g, '')
      const room = await loadFreshRoom(code)
      if (!room) return NextResponse.json({ ok: false })
      return NextResponse.json(eng.publicPeek(room))
    }

    // 状态轮询
    const code = clampStr(sp.get('code'), 8).toUpperCase().replace(/[^A-Z0-9]/g, '')
    const pid = clampStr(sp.get('pid'), 64)
    const name = eng.cleanName(sp.get('name'))
    const state = await pollRoomState(code, pid, name)
    if (!state) return NextResponse.json({ ok: false, expired: true })
    return NextResponse.json({ ok: true, state })
  } catch (e) {
    console.error('[api/gomoku] GET error', e)
    return NextResponse.json({ ok: false, error: 'server error' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ ok: false, message: 'invalid body' }, { status: 400 })
  }

  const action = clampStr(body.action, 40)
  const playerId = clampStr(body.playerId, 64)
  const name = eng.cleanName(body.name)
  const code = clampStr(body.code, 8).toUpperCase().replace(/[^A-Z0-9]/g, '')

  try {
    switch (action) {
      case 'ai:test': {
        const cfg = sanitizeAiConfig(body.config)
        if (!cfg) return NextResponse.json({ ok: false, error: '配置不完整（需要 Base URL 和模型名）' })
        const result = await testAiConnection(cfg)
        return NextResponse.json(result)
      }

      case 'room:create': {
        const mode = body.mode === 'solo' ? 'solo' : 'pvp'
        const difficulty: eng.Difficulty =
          body.difficulty === 'easy' || body.difficulty === 'hard' ? body.difficulty : 'normal'
        const aiConfig = mode === 'solo' ? sanitizeAiConfig(body.aiConfig) : null
        const room = eng.createRoom(mode, difficulty, aiConfig)
        room.code = await newRoomCode()
        await allocateRoom(room)
        eng.takeSeat(room, 'black', playerId || eng.uid(), name)
        if (mode === 'solo') {
          room.seats.white = eng.makeAISeat(aiConfig?.name)
          eng.maybeStart(room)
          await ensureAIMove(room)
        }
        await finalizeMatch(room)
        await saveRoom(room)
        return NextResponse.json({ ok: true, code: room.code, state: eng.publicState(room) })
      }

      case 'room:join': {
        const room = await loadFreshRoom(code, playerId)
        if (!room) return NextResponse.json({ ok: false, message: '房间不存在或已解散，请检查房号' })
        eng.joinRoomState(room, playerId || eng.uid(), name)
        eng.maybeStart(room)
        await ensureAIMove(room)
        await finalizeMatch(room)
        await saveRoom(room)
        return NextResponse.json({ ok: true, state: eng.publicState(room) })
      }

      case 'room:leave': {
        const room = await loadFreshRoom(code, playerId)
        if (!room) return NextResponse.json({ ok: true })
        eng.leaveRoomExplicit(room, playerId)
        await finalizeMatch(room)
        await saveRoom(room)
        return NextResponse.json({ ok: true })
      }

      case 'room:difficulty': {
        const d = body.difficulty
        if (d !== 'easy' && d !== 'normal' && d !== 'hard')
          return NextResponse.json({ ok: false, message: '难度不合法' })
        const room = await loadFreshRoom(code, playerId)
        if (!room || room.mode !== 'solo') return NextResponse.json({ ok: false })
        const myColor = colorOf(room, playerId)
        if (!myColor) return NextResponse.json({ ok: false, message: '仅房内玩家可切换难度' })
        if (room.difficulty !== d) {
          const aiName = room.seats.black?.isAI ? room.seats.black.name : room.seats.white?.name ?? eng.AI_NAME
          const from = eng.DIFFICULTY_LABEL[room.difficulty]
          room.difficulty = d
          room.streakSuggested = false
          eng.pushChat(room, eng.sysMsg(`${aiName} 难度已切换：${from} → ${eng.DIFFICULTY_LABEL[d]}`))
          eng.pushChat(
            room,
            eng.sysMsg(
              `${aiName}（${eng.DIFFICULTY_LABEL[d]}）：${d === 'hard' ? '认真起来了，接招！' : d === 'normal' ? '好的，我们继续切磋～' : '轻松下，你随意～'}`
            )
          )
          await ensureAIMove(room)
          await finalizeMatch(room)
          await saveRoom(room)
        }
        return NextResponse.json({ ok: true, state: eng.publicState(room) })
      }

      case 'game:move': {
        const index = Number(body.index)
        if (!Number.isInteger(index) || index < 0 || index >= eng.CELLS)
          return NextResponse.json({ ok: false, message: '落子不合法' })
        const room = await loadFreshRoom(code, playerId)
        if (!room) return NextResponse.json({ ok: false, message: '房间不存在' })
        if (room.status !== 'playing') return NextResponse.json({ ok: false, message: '对局未在进行中' })
        const myColor = colorOf(room, playerId)
        if (!myColor || myColor !== room.turn)
          return NextResponse.json({ ok: false, message: '还没轮到你落子' })
        if (!eng.applyMove(room, index)) return NextResponse.json({ ok: false, message: '该位置已有棋子' })
        await ensureAIMove(room)
        await finalizeMatch(room)
        await saveRoom(room)
        return NextResponse.json({ ok: true, state: eng.publicState(room) })
      }

      case 'game:resign': {
        const room = await loadFreshRoom(code, playerId)
        if (!room || room.status !== 'playing') return NextResponse.json({ ok: false })
        const myColor = colorOf(room, playerId)
        if (!myColor) return NextResponse.json({ ok: false })
        eng.endGame(room, myColor === 1 ? 2 : 1, 'resign')
        await finalizeMatch(room)
        await saveRoom(room)
        return NextResponse.json({ ok: true, state: eng.publicState(room) })
      }

      case 'game:undo-request': {
        const room = await loadFreshRoom(code, playerId)
        if (!room || room.status !== 'playing' || room.undoReq) return NextResponse.json({ ok: false })
        const myColor = colorOf(room, playerId)
        if (!myColor || room.turn === myColor) return NextResponse.json({ ok: false })
        const mySeat = myColor === 1 ? room.seats.black : room.seats.white
        if (!mySeat || !room.moves.some((m) => m.color === myColor)) return NextResponse.json({ ok: false })
        const opp = myColor === 1 ? room.seats.white : room.seats.black
        if (!opp?.connected) return NextResponse.json({ ok: false, message: '对方不在线' })
        room.undoReq = myColor
        eng.pushChat(room, eng.sysMsg(`${mySeat.name} 请求悔棋`))
        if (opp.isAI) {
          // AI 友好同意（原 setTimeout 延迟改为同步执行）
          eng.performUndoAccept(room)
          await ensureAIMove(room)
        }
        await finalizeMatch(room)
        await saveRoom(room)
        return NextResponse.json({ ok: true, state: eng.publicState(room) })
      }

      case 'game:undo-accept': {
        const room = await loadFreshRoom(code, playerId)
        if (!room || room.status !== 'playing' || !room.undoReq) return NextResponse.json({ ok: false })
        const reqColor = room.undoReq
        const isOpponent = (reqColor === 1 && room.seats.white?.playerId === playerId) || (reqColor === 2 && room.seats.black?.playerId === playerId)
        if (!isOpponent) return NextResponse.json({ ok: false })
        eng.performUndoAccept(room)
        await ensureAIMove(room)
        await finalizeMatch(room)
        await saveRoom(room)
        return NextResponse.json({ ok: true, state: eng.publicState(room) })
      }

      case 'game:undo-reject': {
        const room = await loadFreshRoom(code, playerId)
        if (!room || room.status !== 'playing' || !room.undoReq) return NextResponse.json({ ok: false })
        const reqColor = room.undoReq
        const isOpponent = (reqColor === 1 && room.seats.white?.playerId === playerId) || (reqColor === 2 && room.seats.black?.playerId === playerId)
        if (!isOpponent) return NextResponse.json({ ok: false })
        room.undoReq = null
        eng.pushChat(room, eng.sysMsg('对方拒绝了悔棋请求'))
        await saveRoom(room)
        return NextResponse.json({ ok: true, state: eng.publicState(room) })
      }

      case 'game:rematch': {
        const room = await loadFreshRoom(code, playerId)
        if (!room || room.status !== 'ended') return NextResponse.json({ ok: false })
        const myColor = colorOf(room, playerId)
        if (!myColor) return NextResponse.json({ ok: false })
        const mySeat = myColor === 1 ? room.seats.black : room.seats.white
        if (!mySeat) return NextResponse.json({ ok: false })
        if (!room.rematch[myColor === 1 ? 'black' : 'white']) {
          room.rematch[myColor === 1 ? 'black' : 'white'] = true
          eng.pushChat(room, eng.sysMsg(`${mySeat.name} 想再来一局`))
        }
        const aiKey = room.seats.black?.isAI ? 'black' : room.seats.white?.isAI ? 'white' : null
        if (room.rematch.black && room.rematch.white) {
          eng.resetGame(room, true) // 换边再战
          await ensureAIMove(room)
        } else if (room.mode === 'solo' && aiKey) {
          // AI 稍后自动同意 → 同步执行
          room.rematch[aiKey] = true
          if (room.rematch.black && room.rematch.white) {
            eng.resetGame(room, true)
            await ensureAIMove(room)
          }
        }
        await saveRoom(room)
        return NextResponse.json({ ok: true, state: eng.publicState(room) })
      }

      case 'game:hint': {
        const room = await loadFreshRoom(code, playerId)
        if (!room || room.status !== 'playing') return NextResponse.json({ ok: false })
        const myColor = colorOf(room, playerId)
        if (!myColor || room.turn !== myColor) return NextResponse.json({ ok: false })
        const left = myColor === 1 ? room.hintsLeft.black : room.hintsLeft.white
        if (left <= 0) return NextResponse.json({ ok: false, message: '提示次数已用完' })
        const hint = eng.computeHint(room, myColor)
        if (!hint) return NextResponse.json({ ok: false })
        if (myColor === 1) room.hintsLeft.black -= 1
        else room.hintsLeft.white -= 1
        room.hint = hint
        const kindText = hint.kind === 'win' ? '必胜点' : hint.kind === 'block' ? '防守点' : '推荐点'
        const pos = `${'ABCDEFGHJKLMNOP'[hint.index % eng.SIZE]}${eng.SIZE - Math.floor(hint.index / eng.SIZE)}`
        const seatName = (myColor === 1 ? room.seats.black?.name : room.seats.white?.name) ?? '玩家'
        eng.pushChat(room, eng.sysMsg(`${seatName} 使用了提示（${kindText} ${pos}）`))
        await saveRoom(room)
        return NextResponse.json({ ok: true, state: eng.publicState(room) })
      }

      case 'chat:send': {
        const text = clampStr(body.text, 200).replace(/[\u0000-\u001f<>]/g, '').trim()
        if (!text) return NextResponse.json({ ok: false })
        const room = await loadFreshRoom(code, playerId)
        if (!room) return NextResponse.json({ ok: false })
        let from = '观战者'
        let color = 0
        const myColor = colorOf(room, playerId)
        if (myColor === 1 && room.seats.black) {
          from = room.seats.black.name
          color = 1
        } else if (myColor === 2 && room.seats.white) {
          from = room.seats.white.name
          color = 2
        } else if (room.spectators[playerId]) {
          from = room.spectators[playerId].name
        }
        eng.pushChat(room, { id: eng.uid(), from, color, text, ts: Date.now() })
        await saveRoom(room)
        return NextResponse.json({ ok: true, state: eng.publicState(room) })
      }

      case 'game:react': {
        const emoji = clampStr(body.emoji, 8)
        if (!eng.REACTION_WHITELIST.includes(emoji)) return NextResponse.json({ ok: false })
        const room = await loadFreshRoom(code, playerId)
        if (!room) return NextResponse.json({ ok: false })
        const now = Date.now()
        if (now - (room.reactAt[playerId] ?? 0) < eng.REACTION_COOLDOWN_MS)
          return NextResponse.json({ ok: true }) // 限频静默忽略
        room.reactAt[playerId] = now
        let from = '观战者'
        let color = 0
        const myColor = colorOf(room, playerId)
        if (myColor === 1 && room.seats.black) {
          from = room.seats.black.name
          color = 1
        } else if (myColor === 2 && room.seats.white) {
          from = room.seats.white.name
          color = 2
        } else if (room.spectators[playerId]) {
          from = room.spectators[playerId].name
        }
        eng.pushReaction(room, emoji, from, color, now)
        await saveRoom(room)
        return NextResponse.json({ ok: true, state: eng.publicState(room) })
      }

      default:
        return NextResponse.json({ ok: false, message: '未知操作' }, { status: 400 })
    }
  } catch (e) {
    console.error(`[api/gomoku] action ${action} error`, e)
    return NextResponse.json({ ok: false, error: 'server error' }, { status: 500 })
  }
}
