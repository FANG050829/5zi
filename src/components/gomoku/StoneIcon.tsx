'use client'

// 极简棋子图标（大厅/列表等小尺寸场景）
// 注意：黑/白棋子是"实体棋子"，使用字面量颜色，不随深色模式反转
export function StoneIcon({ color, size = 20 }: { color: number; size?: number }) {
  if (color === 0) {
    return (
      <span
        className="inline-block rounded-full border border-stone-300 bg-stone-100"
        style={{ width: size, height: size }}
        aria-hidden
      />
    )
  }
  return color === 1 ? (
    <span
      className="inline-block rounded-full"
      style={{
        width: size,
        height: size,
        background: 'radial-gradient(circle at 36% 30%, #45403a 0%, #211e1b 42%, #100e0c 100%)',
        boxShadow: 'inset 0 -1px 2px rgba(255,255,255,0.16), 0 1px 2px rgba(0,0,0,0.25)',
      }}
      aria-hidden
    />
  ) : (
    <span
      className="inline-block rounded-full"
      style={{
        width: size,
        height: size,
        background: 'radial-gradient(circle at 36% 30%, #ffffff 0%, #f7f3e9 58%, #e4ddcd 100%)',
        boxShadow: 'inset 0 0 0 1px rgba(28,25,23,0.08), 0 1px 2px rgba(28,25,23,0.16)',
      }}
      aria-hidden
    />
  )
}
