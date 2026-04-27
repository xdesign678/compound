'use client';

import { useAppStore, type ColorMode } from '@/lib/store';
import { FontSizeSelector } from './FontSizeSelector';
import { LineHeightSelector } from './LineHeightSelector';

export function GeneralTab() {
  const homeStyle = useAppStore((s) => s.homeStyle);
  const setHomeStyle = useAppStore((s) => s.setHomeStyle);
  const colorMode = useAppStore((s) => s.colorMode);
  const setColorMode = useAppStore((s) => s.setColorMode);

  return (
    <div className="settings-tab-content">
      <div className="settings-tool-row settings-tool-row-flat">
        <div>
          <div className="settings-tool-title">颜色模式</div>
          <div className="settings-card-desc">浅色、深色或跟随系统</div>
        </div>
        <div className="settings-segmented settings-segmented-three">
          {(['light', 'dark', 'system'] as ColorMode[]).map((mode) => (
            <button
              key={mode}
              className={colorMode === mode ? 'active' : ''}
              onClick={() => setColorMode(mode)}
            >
              {mode === 'light' ? '浅色' : mode === 'dark' ? '深色' : '系统'}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-tool-row settings-tool-row-flat">
        <div>
          <div className="settings-tool-title">正文字号</div>
          <div className="settings-card-desc">调整 Wiki 和资料详情页阅读字号</div>
        </div>
        <FontSizeSelector />
      </div>

      <div className="settings-tool-row settings-tool-row-flat">
        <div>
          <div className="settings-tool-title">行间距</div>
          <div className="settings-card-desc">调整详情页正文行间距</div>
        </div>
        <LineHeightSelector />
      </div>

      <div className="settings-tool-row settings-tool-row-flat">
        <div>
          <div className="settings-tool-title">首页样式</div>
          <div className="settings-card-desc">动态流或分类知识库</div>
        </div>
        <div className="settings-segmented">
          <button
            className={homeStyle === 'feed' ? 'active' : ''}
            onClick={() => setHomeStyle('feed')}
          >
            动态流
          </button>
          <button
            className={homeStyle === 'library' ? 'active' : ''}
            onClick={() => setHomeStyle('library')}
          >
            知识库
          </button>
        </div>
      </div>
    </div>
  );
}
