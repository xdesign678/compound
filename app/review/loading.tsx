export default function ReviewLoading() {
  return (
    <main className="ops-page review-page">
      <header className="ops-topbar">
        <div>
          <div className="ops-kicker">Compound Ops</div>
          <h1>审核队列</h1>
          <p>加载中…</p>
        </div>
      </header>
      <section className="review-list">
        {Array.from({ length: 3 }).map((_, i) => (
          <article
            key={i}
            className="review-card"
            style={{ opacity: 0.5, animation: 'pulse 1.5s ease-in-out infinite' }}
          >
            <div className="review-card-head">
              <span
                className="review-kind-tag"
                style={{
                  display: 'inline-block',
                  width: 80,
                  height: 20,
                  background: 'var(--bg-skeleton, #e8e6e1)',
                  borderRadius: 4,
                }}
              />
              <span
                style={{
                  display: 'inline-block',
                  width: 50,
                  height: 20,
                  background: 'var(--bg-skeleton, #e8e6e1)',
                  borderRadius: 4,
                }}
              />
            </div>
            <div style={{ marginTop: 12 }}>
              <div
                style={{
                  width: '70%',
                  height: 18,
                  background: 'var(--bg-skeleton, #e8e6e1)',
                  borderRadius: 4,
                  marginBottom: 8,
                }}
              />
              <div
                style={{
                  width: '90%',
                  height: 14,
                  background: 'var(--bg-skeleton, #e8e6e1)',
                  borderRadius: 4,
                  marginBottom: 6,
                }}
              />
              <div
                style={{
                  width: '60%',
                  height: 14,
                  background: 'var(--bg-skeleton, #e8e6e1)',
                  borderRadius: 4,
                }}
              />
            </div>
          </article>
        ))}
      </section>
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @keyframes pulse {
              0%, 100% { opacity: 0.5; }
              50% { opacity: 0.3; }
            }
          `,
        }}
      />
    </main>
  );
}
