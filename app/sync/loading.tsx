export default function SyncLoading() {
  return (
    <main className="sync-v2-page">
      <div className="sync-v2-topnav">
        <div className="sync-v2-topnav-left">
          <span className="sync-v2-kicker">Compound · 同步控制台</span>
        </div>
      </div>
      <div className="sync-v2-loading">
        <div aria-hidden="true" className="sync-v2-loading-spinner" />
        <p>加载同步状态…</p>
      </div>
    </main>
  );
}
