'use client';

import { useState, useEffect, useRef, useCallback, type CSSProperties } from 'react';
import {
  fetchCustomModels,
  getHiddenPresetModels,
  getLlmConfig,
  hidePresetModel,
  modelLabel,
  PRESET_MODELS,
  rememberCustomModelOnServer,
  removeCustomModelOnServer,
  saveLlmConfig,
} from '@/lib/llm-config';
import { clearAdminToken, getAdminToken, saveAdminToken } from '@/lib/admin-auth-client';
import type { LlmConfig } from '@/lib/types';
import { Icon } from '../Icons';

const MODEL_CHIP_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  paddingRight: 6,
};

const MODEL_CHIP_LABEL_STYLE: CSSProperties = {
  border: 0,
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  cursor: 'pointer',
  padding: '0 2px 0 0',
};

const MODEL_CHIP_DELETE_STYLE: CSSProperties = {
  width: 16,
  height: 16,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 0,
  borderRadius: 999,
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  fontSize: 13,
  lineHeight: 1,
  opacity: 0.62,
  padding: 0,
};

export function ModelTab() {
  const [llmConfig, setLlmConfig] = useState<LlmConfig>({});
  const [customModels, setCustomModels] = useState<string[]>([]);
  const [hiddenPresetModels, setHiddenPresetModels] = useState<string[]>([]);
  const [llmAdvancedExpanded, setLlmAdvancedExpanded] = useState(false);
  const [llmSaved, setLlmSaved] = useState(false);
  const [adminToken, setAdminToken] = useState('');
  const [adminSaved, setAdminSaved] = useState(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const safeTimeout = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(fn, ms);
    timersRef.current.push(id);
    return id;
  }, []);

  useEffect(() => {
    const timers = timersRef.current;
    setLlmConfig(getLlmConfig());
    setHiddenPresetModels(getHiddenPresetModels());
    setAdminToken(getAdminToken());
    void fetchCustomModels()
      .then(setCustomModels)
      .catch(() => setCustomModels([]));
    return () => {
      timers.forEach(clearTimeout);
    };
  }, []);

  async function saveLlm() {
    saveLlmConfig(llmConfig);
    const model = llmConfig.model?.trim();
    if (model) {
      const models = await rememberCustomModelOnServer(model).catch(() => customModels);
      setCustomModels(models);
    }
    setLlmSaved(true);
    safeTimeout(() => setLlmSaved(false), 2000);
  }

  async function removeCustomModel(model: string) {
    const models = await removeCustomModelOnServer(model).catch(() =>
      customModels.filter((item) => item !== model),
    );
    setCustomModels(models);
    setLlmConfig((config) => {
      if (config.model !== model) return config;
      const next = { ...config, model: '' };
      saveLlmConfig(next);
      return next;
    });
  }

  function removePresetModel(model: string) {
    setHiddenPresetModels(hidePresetModel(model));
    setLlmConfig((config) => {
      if (config.model !== model) return config;
      const next = { ...config, model: '' };
      saveLlmConfig(next);
      return next;
    });
  }

  function saveAdmin() {
    saveAdminToken(adminToken);
    setAdminSaved(true);
    safeTimeout(() => setAdminSaved(false), 2000);
  }

  function clearAdmin() {
    clearAdminToken();
    setAdminToken('');
    setAdminSaved(true);
    safeTimeout(() => setAdminSaved(false), 2000);
  }

  return (
    <div className="settings-tab-content">
      {/* LLM 配置 */}
      <div className="settings-card-head">
        <div className="settings-card-icon">
          <Icon.Sparkle />
        </div>
        <div>
          <div className="settings-card-title">LLM 配置</div>
          <div className="settings-card-desc">
            默认使用 Zeabur 服务端配置；可临时覆盖当前浏览器的模型。
          </div>
        </div>
      </div>

      <div className="settings-fields">
        <label className="settings-field">
          <span>模型</span>
          <input
            type="text"
            placeholder="anthropic/claude-sonnet-4.6"
            value={llmConfig.model || ''}
            onChange={(e) => setLlmConfig((c) => ({ ...c, model: e.target.value }))}
          />
        </label>

        <div className="settings-preset-row">
          {PRESET_MODELS.map((item) => item.value)
            .filter((model) => !hiddenPresetModels.includes(model))
            .map((model) => (
              <span
                key={model}
                className={`settings-preset${llmConfig.model === model ? ' active' : ''}`}
                style={MODEL_CHIP_STYLE}
                title={model}
              >
                <button
                  type="button"
                  style={MODEL_CHIP_LABEL_STYLE}
                  onClick={() => setLlmConfig((c) => ({ ...c, model }))}
                >
                  {modelLabel(model)}
                </button>
                <button
                  type="button"
                  style={MODEL_CHIP_DELETE_STYLE}
                  aria-label={`删除模型 ${modelLabel(model)}`}
                  title="删除"
                  onClick={() => removePresetModel(model)}
                >
                  ×
                </button>
              </span>
            ))}
          {customModels.map((model) => (
            <span
              key={model}
              className={`settings-preset${llmConfig.model === model ? ' active' : ''}`}
              style={MODEL_CHIP_STYLE}
              title={model}
            >
              <button
                type="button"
                style={MODEL_CHIP_LABEL_STYLE}
                onClick={() => setLlmConfig((c) => ({ ...c, model }))}
              >
                {modelLabel(model)}
              </button>
              <button
                type="button"
                style={MODEL_CHIP_DELETE_STYLE}
                aria-label={`删除模型 ${modelLabel(model)}`}
                title="删除"
                onClick={() => void removeCustomModel(model)}
              >
                ×
              </button>
            </span>
          ))}
        </div>

        <div className="settings-advanced-block">
          <button
            className="settings-inline-toggle"
            type="button"
            aria-expanded={llmAdvancedExpanded}
            onClick={() => setLlmAdvancedExpanded((value) => !value)}
          >
            <span>高级配置</span>
            <span>{llmAdvancedExpanded ? '收起' : '展开'}</span>
          </button>

          {!llmAdvancedExpanded && (
            <div className="settings-inline-note">API Key 与 API URL 默认跟随服务端配置。</div>
          )}

          {llmAdvancedExpanded && (
            <>
              <label className="settings-field">
                <span>API Key</span>
                <input
                  type="password"
                  placeholder="sk-... 或 OpenRouter key"
                  value={llmConfig.apiKey || ''}
                  onChange={(e) => setLlmConfig((c) => ({ ...c, apiKey: e.target.value }))}
                />
              </label>

              <label className="settings-field">
                <span>
                  API URL <em>可选</em>
                </span>
                <input
                  type="text"
                  placeholder="https://openrouter.ai/api/v1/chat/completions"
                  value={llmConfig.apiUrl || ''}
                  onChange={(e) => setLlmConfig((c) => ({ ...c, apiUrl: e.target.value }))}
                />
              </label>
            </>
          )}
        </div>

        <button className="modal-btn primary settings-primary-action" onClick={saveLlm}>
          {llmSaved ? '已保存 ✓' : '保存配置'}
        </button>
      </div>

      {/* 访问保护 */}
      <div className="settings-tab-divider" />

      <div className="settings-card-head">
        <div className="settings-card-icon">
          <Icon.Settings />
        </div>
        <div>
          <div className="settings-card-title">访问保护</div>
          <div className="settings-card-desc">
            服务端开启 ADMIN_TOKEN 后，在这里保存同一个密钥。
          </div>
        </div>
      </div>

      <div className="settings-fields">
        <label className="settings-field">
          <span>Admin Token</span>
          <input
            type="password"
            placeholder="与服务端 ADMIN_TOKEN 保持一致"
            value={adminToken}
            onChange={(e) => setAdminToken(e.target.value)}
          />
        </label>

        <div className="settings-action-row">
          <button className="modal-btn primary" onClick={saveAdmin}>
            {adminSaved ? '已保存 ✓' : '保存访问密钥'}
          </button>
          <button className="modal-btn settings-secondary-action" onClick={clearAdmin}>
            清除
          </button>
        </div>
      </div>
    </div>
  );
}
