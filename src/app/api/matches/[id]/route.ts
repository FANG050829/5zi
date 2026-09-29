import { NextRequest, NextResponse } from 'next/server'
import { getAllMatches } from '@/server/match-store'

export const dynamic = 'force-dynamic'

// 对局详情（棋谱回放）：GET /api/matches/:id
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const numId = Number(id)
    if (!Number.isInteger(numId) || numId <= 0) {
      return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })
    }
    const m = (await getAllMatches()).find((x) => x.id === numId)
    if (!m) {
      return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 })
    }
    // 解析棋谱 "idx,color;..." → [{index,color}]
    const moves = m.moves
      ? m.moves
          .split(';')
          .filter(Boolean)
          .map((pair) => {
            const [idx, color] = pair.split(',')
            return { index: Number(idx), color: Number(color) === 2 ? 2 : 1 }
          })
          .filter((mv) => Number.isInteger(mv.index) && mv.index >= 0 && mv.index < 225)
      : []
    // 解析评估曲线 "50,62,..." → number[]（仅保留 0-100 合法值）
    const evals = m.evals
      ? m.evals
          .split(',')
          .map(Number)
          .filter((v) => Number.isFinite(v) && v >= 0 && v <= 100)
      : []
    return NextResponse.json({
      ok: true,
      match: {
        id: m.id,
        roomCode: m.roomCode,
        blackName: m.blackName,
        whiteName: m.whiteName,
        winnerColor: m.winnerColor,
        endReason: m.endReason,
        moveCount: m.moveCount,
        durationMs: m.durationMs,
        mode: m.mode,
        difficulty: m.difficulty,
        moves,
        evals,
        createdAt: m.createdAt,
      },
    })
  } catch (e) {
    console.error('[api/matches/:id] GET error', e)
    return NextResponse.json({ ok: false, error: 'server error' }, { status: 500 })
  }
}
