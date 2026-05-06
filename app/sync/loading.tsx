export default function SyncLoading() {
  return (
    <main className="sync-v2-page">
      <div className="sync-v2-topnav">
        <div className="sync-v2-topnav-left">
          <span className="sync-v2-kicker">Compound · 同步控制台</span>
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '64px 24px',
          gap: 16,
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            border: '3px solid var(--border-muted, #e0ddd8)',
            borderTopColor: 'var(--text-primary, #141413)',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }}
        />
        <p style={{ fontSize: 15, color: 'var(--text-secondary, #5e5d59)' }}>加载同步状态…</p>
      </div>
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @keyframes spin {
              to { transform: rotate(360deg); }
            }
          `,
        }}
      />
    </main>
  );
}
