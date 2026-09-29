// R9 段位系统回归：rankFromRecord 阈值 + /api/rank 聚合
import { rankFromRecord } from '../src/lib/gomoku/rank.ts'

let pass = 0
let fail = 0
const assert = (cond, msg) => {
  if (cond) {
    pass++
    console.log('  ✓', msg)
  } else {
    fail++
    console.log('  ✗', msg)
  }
}

console.log('[1] rankFromRecord 阈值')
{
  const r0 = rankFromRecord({ wins: 0, losses: 0, draws: 0 })
  assert(r0.tier.name === '初学' && r0.rp === 0, '零战绩 → 初学 0 RP')
  assert(r0.rpToNext === 3, '距入门还差 3 RP')
  const r1 = rankFromRecord({ wins: 1, losses: 0, draws: 0 })
  assert(r1.tier.name === '入门' && r1.rp === 3, '1胜 → 入门 3 RP')
  const r2 = rankFromRecord({ wins: 3, losses: 0, draws: 1 })
  assert(r2.tier.name === '棋童' && r2.rp === 10, '3胜1和 → 棋童 10 RP')
  const r3 = rankFromRecord({ wins: 10, losses: 1, draws: 2 })
  assert(r3.tier.name === '高手' && r3.rp === 31, '10胜1负2和 → 高手 31 RP')
  const r4 = rankFromRecord({ wins: 20, losses: 3, draws: 5 })
  assert(r4.tier.name === '棋圣' && r4.rp === 62, '20胜3负5和 → 棋圣 62 RP')
  const r5 = rankFromRecord({ wins: 50, losses: 5, draws: 10 })
  assert(r5.tier.name === '棋神' && r5.rp === 155 && r5.next === null && r5.progress === 1, '50胜 → 棋神（顶段，无下级）')
  const rn = rankFromRecord({ wins: 40, losses: 5, draws: 5 })
  assert(rn.tier.name === '宗师' && rn.rp === 120 && rn.rpToNext === 20, '宗师(120RP) 距棋神还差 20 RP')
  const rneg = rankFromRecord({ wins: 0, losses: 99, draws: 0 })
  assert(rneg.rp === 0 && rneg.tier.name === '初学', '连败 RP 不为负（下限 0）')
  assert(r0.progress >= 0 && r0.progress <= 1, '进度钳制在 0-1')
}

console.log('[2] /api/rank 聚合')
const pid = 'rankchk-' + Date.now()
{
  const r = await fetch(`http://127.0.0.1:3000/api/rank?pids=${pid}`)
  const d = await r.json()
  assert(d?.ok && Number(d.ranks?.[pid]?.total ?? -1) === 0, '未知 pid → total=0')
}
{
  // 落库一局：pid 执黑胜
  const post = await fetch('http://127.0.0.1:3000/api/matches', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      roomCode: 'RK01',
      blackName: '段位测试·黑',
      whiteName: '段位测试·白',
      blackPid: pid,
      whitePid: 'rankchk-opp-' + Date.now(),
      winnerColor: 1,
      endReason: 'five',
      moveCount: 23,
      durationMs: 120000,
      mode: 'pvp',
    }),
  })
  const pd = await post.json()
  assert(pd?.ok === true, 'POST /api/matches 落库成功')
}
{
  const r = await fetch(`http://127.0.0.1:3000/api/rank?pids=${pid}`)
  const d = await r.json()
  const rec = d?.ranks?.[pid]
  assert(rec?.total === 1 && rec?.wins === 1 && rec?.losses === 0, '聚合：1 局 1 胜 0 负')
}
{
  const r = await fetch('http://127.0.0.1:3000/api/rank')
  const d = await r.json()
  assert(d?.ok && Object.keys(d.ranks ?? {}).length === 0, '空参数 → 空 ranks')
}

console.log(`\n结果: ${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
