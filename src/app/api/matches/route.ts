import { NextRequest, NextResponse } from 'next/server'
import { createMatch, getAllMatches } from '@/server/match-store'

export const dynamic = 'force-dynamic'

// 对局结束上报（由对战服务回调）
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const roomCode = String(body?.roomCode ?? '').slice(0, 8)
    const blackName = String(body?.blackName ?? '').slice(0, 20) || '黑方'
    const whiteName = String(body?.whiteName ?? '').slice(0, 20) || '白方'
    const winnerColor = Number(body?.winnerColor)
    const endReason = ['five', 'timeout', 'resign', 'disconnect', 'draw'].includes(body?.endReason)
      ? body.endReason
      : 'five'
    const moveCount = Math.max(0, Math.min(500, Number(body?.moveCount) || 0))
    const durationMs = Math.max(0, Math.min(24 * 3600 * 1000, Number(body?.durationMs) || 0))
    const mode = body?.mode === 'solo' ? 'solo' : 'pvp'
    const difficulty = ['easy', 'normal', 'hard'].includes(body?.difficulty) ? body.difficulty : ''
    // 棋谱序列化："idx,color;idx,color"（清洗非法字符，限长）
    const moves = String(body?.moves ?? '')
      .replace(/[^0-9,;]/g, '')
      .slice(0, 4000)
    // 评估曲线："50,62,48,..."（整数百分比，限长）
    const evals = String(body?.evals ?? '')
      .replace(/[^0-9,]/g, '')
      .slice(0, 1200)
    // 设备标识（本机档案聚合用）
    const blackPid = String(body?.blackPid ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)
    const whitePid = String(body?.whitePid ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)

    if (!roomCode || ![0, 1, 2].includes(winnerColor)) {
      return NextResponse.json({ ok: false, error: 'invalid payload' }, { status: 400 })
    }

    const id = await createMatch({
      roomCode,
      blackName,
      whiteName,
      blackPid,
      whitePid,
      winnerColor,
      endReason,
      moveCount,
      durationMs,
      mode,
      difficulty,
      moves,
      evals,
    })
    return NextResponse.json({ ok: true, id })
  } catch (e) {
    console.error('[api/matches] POST error', e)
    return NextResponse.json({ ok: false, error: 'server error' }, { status: 500 })
  }
}

// 大厅展示：最近对局 + 总览；?all=1 时返回全量对局（供战绩统计，限 500 条）；
// ?pid=xxx 返回该设备参与的对局（本机档案）+ summary 汇总
export async function GET(req: NextRequest) {
  try {
    const all = req.nextUrl.searchParams.get('all') === '1'
    const pid = (req.nextUrl.searchParams.get('pid') ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)

    const rows = await getAllMatches() // 升序

    // 本机档案：按设备标识查询
    if (pid) {
      const mine = rows
        .filter((m) => m.blackPid === pid || m.whitePid === pid)
        .slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 200)
      const games = mine.map((m) => {
        const myColor: 1 | 2 = m.blackPid === pid ? 1 : 2
        const outcome = m.winnerColor === 0 ? 'draw' : m.winnerColor === myColor ? 'win' : 'lose'
        return {
          id: m.id,
          roomCode: m.roomCode,
          myColor,
          oppName: myColor === 1 ? m.whiteName : m.blackName,
          blackName: m.blackName,
          whiteName: m.whiteName,
          outcome,
          endReason: m.endReason,
          moveCount: m.moveCount,
          durationMs: m.durationMs,
          mode: m.mode,
          difficulty: m.difficulty,
          hasReplay: true,
          createdAt: m.createdAt,
        }
      })
      const summary = {
        total: games.length,
        wins: games.filter((g) => g.outcome === 'win').length,
        losses: games.filter((g) => g.outcome === 'lose').length,
        draws: games.filter((g) => g.outcome === 'draw').length,
      }
      return NextResponse.json({ ok: true, pid, summary, mine: games })
    }

    const desc = rows.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    const recent = desc.slice(0, all ? 500 : 8)
    const base = {
      ok: true,
      totals: {
        total: rows.length,
        blackWins: rows.filter((m) => m.winnerColor === 1).length,
        whiteWins: rows.filter((m) => m.winnerColor === 2).length,
      },
      recent: recent.map((m) => ({
        id: m.id,
        roomCode: m.roomCode,
        blackName: m.blackName,
        whiteName: m.whiteName,
        blackPid: m.blackPid,
        whitePid: m.whitePid,
        winnerColor: m.winnerColor,
        endReason: m.endReason,
        moveCount: m.moveCount,
        durationMs: m.durationMs,
        mode: m.mode,
        difficulty: m.difficulty,
        hasReplay: !!m.moves,
        createdAt: m.createdAt,
      })),
    }
    if (all) {
      // 全量精简返回：不含棋谱正文，供客户端聚合战绩
      const allMatches = rows.slice(-500).map((m) => ({
        id: m.id,
        blackName: m.blackName,
        whiteName: m.whiteName,
        winnerColor: m.winnerColor,
        endReason: m.endReason,
        moveCount: m.moveCount,
        durationMs: m.durationMs,
        mode: m.mode,
        difficulty: m.difficulty,
        createdAt: m.createdAt,
      }))
      return NextResponse.json({ ...base, all: allMatches })
    }
    return NextResponse.json(base)
  } catch (e) {
    console.error('[api/matches] GET error', e)
    return NextResponse.json({ ok: false, error: 'server error' }, { status: 500 })
  }
}
