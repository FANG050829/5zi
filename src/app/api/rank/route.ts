import { NextRequest, NextResponse } from 'next/server'
import { getAllMatches } from '@/server/match-store'

export const dynamic = 'force-dynamic'

// 段位查询：?pids=a,b,c（≤4 个）返回各 pid 的战绩汇总（供座位卡/大厅段位徽章）
export async function GET(req: NextRequest) {
  try {
    const raw = (req.nextUrl.searchParams.get('pids') ?? '')
      .split(',')
      .map((s) => s.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64))
      .filter(Boolean)
      .slice(0, 4)

    if (raw.length === 0) {
      return NextResponse.json({ ok: true, ranks: {} })
    }

    const rows = await getAllMatches()
    const ranks: Record<string, { total: number; wins: number; losses: number; draws: number }> = {}
    for (const pid of raw) {
      // 分别统计参与对局与获胜/失利（黑白两方向）
      let total = 0
      let wins = 0
      let losses = 0
      for (const m of rows) {
        const isBlack = m.blackPid === pid
        const isWhite = m.whitePid === pid
        if (!isBlack && !isWhite) continue
        total += 1
        if (m.winnerColor === 0) continue
        if ((m.winnerColor === 1 && isBlack) || (m.winnerColor === 2 && isWhite)) wins += 1
        else losses += 1
      }
      ranks[pid] = { total, wins, losses, draws: Math.max(0, total - wins - losses) }
    }
    return NextResponse.json({ ok: true, ranks })
  } catch (e) {
    console.error('[api/rank] GET error', e)
    return NextResponse.json({ ok: false, error: 'server error' }, { status: 500 })
  }
}
