import { NextRequest, NextResponse } from 'next/server'
import { getAllMatches } from '@/server/match-store'

export const dynamic = 'force-dynamic'

/**
 * 交手记录（head-to-head）：按双方设备标识查询历史对阵。
 * ?aPid=&bPid= → { total, aWins, bWins, draws }（aPid 视角，最近 500 局内统计）
 */
export async function GET(req: NextRequest) {
  try {
    const clean = (v: string | null) => (v ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)
    const aPid = clean(req.nextUrl.searchParams.get('aPid'))
    const bPid = clean(req.nextUrl.searchParams.get('bPid'))
    if (!aPid || !bPid || aPid === bPid) {
      return NextResponse.json({ ok: false, error: 'invalid pids' }, { status: 400 })
    }

    const rows = (await getAllMatches())
      .filter(
        (m) =>
          (m.blackPid === aPid && m.whitePid === bPid) ||
          (m.blackPid === bPid && m.whitePid === aPid)
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 500)

    let aWins = 0
    let bWins = 0
    let draws = 0
    for (const m of rows) {
      if (m.winnerColor === 0) draws += 1
      else {
        const winnerPid = m.winnerColor === 1 ? m.blackPid : m.whitePid
        if (winnerPid === aPid) aWins += 1
        else bWins += 1
      }
    }

    return NextResponse.json({
      ok: true,
      total: rows.length,
      aWins,
      bWins,
      draws,
      // aPid 最近一次交手是否获胜（用于文案「上回合你赢了」）
      lastWinnerPid:
        rows.length && rows[0].winnerColor !== 0
          ? rows[0].winnerColor === 1
            ? rows[0].blackPid
            : rows[0].whitePid
          : null,
    })
  } catch (e) {
    console.error('[api/matches/head2head] GET error', e)
    return NextResponse.json({ ok: false, error: 'server error' }, { status: 500 })
  }
}
