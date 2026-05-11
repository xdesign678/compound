import Link from 'next/link';

export default function NotFound() {
  return (
    <main
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100dvh',
        padding: '48px 24px',
        fontFamily: 'var(--font-reading, Lora, serif)',
        background: 'var(--bg-primary, #faf9f5)',
        color: 'var(--text-primary, #141413)',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          fontSize: 64,
          lineHeight: 1,
          marginBottom: 16,
          opacity: 0.8,
        }}
        aria-hidden="true"
      >
        404
      </div>
      <h1
        style={{
          fontSize: 24,
          fontWeight: 600,
          margin: '0 0 12px',
          letterSpacing: '-0.01em',
        }}
      >
        页面未找到
      </h1>
      <p
        style={{
          fontSize: 15,
          color: 'var(--text-secondary, #5e5d59)',
          maxWidth: 400,
          lineHeight: 1.7,
          margin: '0 0 32px',
        }}
      >
        你访问的页面不存在，可能已被移动或删除。 试试回到首页，用搜索找到你需要的内容。
      </p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
        <Link
          href="/"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '10px 20px',
            borderRadius: 8,
            background: 'var(--text-primary, #141413)',
            color: 'var(--bg-primary, #faf9f5)',
            fontSize: 14,
            fontWeight: 500,
            textDecoration: 'none',
            transition: 'opacity 0.15s',
          }}
        >
          返回首页
        </Link>
        <Link
          href="/?focus=search"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '10px 20px',
            borderRadius: 8,
            background: 'transparent',
            border: '1px solid var(--border-primary, #e0ddd8)',
            color: 'var(--text-primary, #141413)',
            fontSize: 14,
            fontWeight: 500,
            textDecoration: 'none',
            transition: 'border-color 0.15s',
          }}
        >
          搜索知识库
        </Link>
      </div>
      <p
        style={{
          marginTop: 48,
          fontSize: 12,
          color: 'var(--text-muted, #9c9a93)',
        }}
      >
        Compound 知识库
      </p>
    </main>
  );
}
