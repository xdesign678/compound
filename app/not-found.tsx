import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="not-found">
      <div className="not-found-code" aria-hidden="true">
        404
      </div>
      <h1 className="not-found-title">页面未找到</h1>
      <p className="not-found-desc">
        你访问的页面不存在，可能已被移动或删除。 试试回到首页，用搜索找到你需要的内容。
      </p>
      <div className="not-found-actions">
        <Link href="/" className="not-found-btn not-found-btn-primary">
          返回首页
        </Link>
        <Link href="/?focus=search" className="not-found-btn not-found-btn-secondary">
          搜索知识库
        </Link>
      </div>
      <p className="not-found-footer">Compound 知识库</p>
    </main>
  );
}
