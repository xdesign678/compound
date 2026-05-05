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
        color: '#141413',
        background: '#faf9f5',
        padding: '32px',
        textAlign: 'center',
      }}
    >
      <h1 style={{ fontSize: '24px', fontWeight: 600, marginBottom: '12px' }}>离线模式</h1>
      <p style={{ fontSize: '16px', color: '#5e5d59', maxWidth: '400px', lineHeight: 1.6 }}>
        当前无法连接网络。你可以继续浏览已缓存的知识库内容。写入操作（摄入、修复、归类）将在恢复连接后可用。
      </p>
      <button
        onClick={() => {
          if (typeof window !== 'undefined') window.location.href = '/';
        }}
        style={{
          marginTop: '24px',
          padding: '10px 24px',
          fontSize: '15px',
          fontWeight: 500,
          color: '#faf9f5',
          background: '#0f0f0e',
          border: 'none',
          borderRadius: '8px',
          cursor: 'pointer',
        }}
      >
        返回知识库
      </button>
    </div>
  );
}
