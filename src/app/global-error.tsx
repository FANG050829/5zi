'use client'

/**
 * 根级错误兜底：替代 root layout 渲染，必须自带 <html>/<body>。
 * 纸墨世界的意外现场：一句致歉、一枚墨子、一条回路。
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="zh-CN">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 18,
          background: '#fcfbf8',
          color: '#1c1917',
          fontFamily:
            'var(--font-noto-serif-sc), "Noto Serif SC", "Songti SC", "SimSun", serif, system-ui, sans-serif',
          padding: 24,
          textAlign: 'center',
        }}
      >
        <span
          style={{
            width: 22,
            height: 22,
            borderRadius: '50%',
            background: 'radial-gradient(circle at 36% 30%, #45403a 0%, #211e1b 42%, #100e0c 100%)',
            boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
          }}
          aria-hidden
        />
        <h1 style={{ fontSize: 22, fontWeight: 300, letterSpacing: '0.3em', margin: 0, textIndent: '0.3em' }}>
          棋局中断
        </h1>
        <p style={{ fontSize: 13, color: '#78716c', margin: 0, letterSpacing: '0.08em' }}>
          对局服务遇到了一点意外，请重试。
        </p>
        <pre
          style={{
            maxWidth: 640,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontSize: 11,
            lineHeight: 1.6,
            color: '#a8a29e',
            background: '#f5f4f0',
            border: '1px solid #e7e5e4',
            borderRadius: 12,
            padding: '10px 14px',
            textAlign: 'left',
          }}
        >
          {error.message}
          {error.digest ? `\ndigest: ${error.digest}` : ''}
        </pre>
        <button
          onClick={reset}
          style={{
            marginTop: 6,
            height: 40,
            padding: '0 28px',
            borderRadius: 12,
            border: 'none',
            background: '#1c1917',
            color: '#fafaf9',
            fontSize: 13,
            letterSpacing: '0.2em',
            cursor: 'pointer',
          }}
        >
          重新开局
        </button>
      </body>
    </html>
  )
}
