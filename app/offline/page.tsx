import Link from 'next/link';

export default function OfflinePage() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        fontFamily: 'system-ui, sans-serif',
        color: 'var(--offline-text, #141413)',
        background: 'var(--offline-bg, #faf9f5)',
        padding: '32px',
        textAlign: 'center',
      }}
    >
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @media (prefers-color-scheme: dark) {
              :root {
                --offline-bg: #1a1a1a;
                --offline-text: #e8e6e1;
                --offline-muted: #a3a19c;
                --offline-btn-bg: #e8e6e1;
                --offline-btn-text: #1a1a1a;
              }
            }
            @media (prefers-color-scheme: light) {
              :root {
                --offline-bg: #faf9f5;
                --offline-text: #141413;
                --offline-muted: #5e5d59;
                --offline-btn-bg: #0f0f0e;
                --offline-btn-text: #faf9f5;
              }
            }
          `,
        }}
      />
      <h1 style={{ fontSize: '24px', fontWeight: 600, marginBottom: '12px' }}>离线模式</h1>
      <p
        style={{
          fontSize: '16px',
          color: 'var(--offline-muted, #5e5d59)',
          maxWidth: '400px',
          lineHeight: 1.6,
        }}
      >
        当前无法连接网络。你可以继续浏览已缓存的知识库内容。写入操作（摄入、修复、归类）将在恢复连接后可用。
      </p>
      <Link
        href="/"
        aria-label="返回知识库首页"
        style={{
          marginTop: '24px',
          padding: '10px 24px',
          fontSize: '15px',
          fontWeight: 500,
          color: 'var(--offline-btn-text, #faf9f5)',
          background: 'var(--offline-btn-bg, #0f0f0e)',
          border: 'none',
          borderRadius: '8px',
          cursor: 'pointer',
          textDecoration: 'none',
          display: 'inline-block',
        }}
      >
        返回知识库
      </Link>
    </div>
  );
}
