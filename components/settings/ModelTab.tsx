'use client';

import { useState, useEffect, useRef, useCallback, type CSSProperties } from 'react';
import {
  clearLlmConfig,
  fetchModelSettings,
  getLlmConfig,
  hidePresetModelOnServer,
  isLlmRemembered,
  modelLabel,
  PRESET_MODELS,
  rememberCustomModelOnServer,
  removeCustomModelOnServer,
  saveLlmConfig,
  saveSelectedModelOnServer,
  setLlmRemember,
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

interface ModelUsageSummary {
  windowDays: number;
  totals: {
    runs: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    avgLatencyMs: number | null;
  };
  byModel: Array<{
    model: string;
    runs: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    avgLatencyMs: number | null;
  }>;
  byTask: Array<{
    task: string;
    runs: number;
    costUsd: number;
    avgLatencyMs: number | null;
  }>;
  recentFailures: Array<{
    task: string;
    model: string;
    createdAt: number;
  }>;
}

function formatUsd(value: number): string {
  if (value <= 0) return '$0.00';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN', { notation: 'compact' }).format(value);
}

export function ModelTab() {
  const [llmConfig, setLlmConfig] = useState<LlmConfig>({});
  const [customModels, setCustomModels] = useState<string[]>([]);
  const [hiddenPresetModels, setHiddenPresetModels] = useState<string[]>([]);
  const [llmAdvancedExpanded, setLlmAdvancedExpanded] = useState(false);
  const [llmRemember, setLlmRemember] = useState(isLlmRemembered());
  const [llmSaved, setLlmSaved] = useState(false);
  const [adminToken, setAdminToken] = useState('');
  const [adminSaved, setAdminSaved] = useState(false);
  const [usage, setUsage] = useState<ModelUsageSummary | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const safeTimeout = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(fn, ms);
    timersRef.current.push(id);
    return id;
  }, []);

  useEffect(() => {
    const timers = timersRef.current;
    const localConfig = getLlmConfig();
    setLlmConfig(localConfig);
    setAdminToken(getAdminToken());
    void fetchModelSettings()
      .then((settings) => {
        setCustomModels(settings.models);
        setHiddenPresetModels(settings.hiddenPresetModels);
        setLlmConfig({ ...localConfig, model: settings.selectedModel });
      })
      .catch(() => {
        setCustomModels([]);
        setHiddenPresetModels([]);
      });
    return () => {
      timers.forEach(clearTimeout);
    };
  }, []);

  const loadUsage = useCallback(async () => {
    setUsageLoading(true);
    try {
      const res = await fetch('/api/ops/model-runs?days=14', { method: 'GET' });
      if (!res.ok) throw new Error(`usage status ${res.status}`);
      setUsage((await res.json()) as ModelUsageSummary);
    } catch {
      setUsage(null);
    } finally {
      setUsageLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsage();
  }, [loadUsage]);

  async function saveLlm() {
    saveLlmConfig(llmConfig);
    const model = llmConfig.model?.trim();
    if (model) {
      const models = await rememberCustomModelOnServer(model).catch(() => customModels);
      setCustomModels(models);
    }
    const settings = await saveSelectedModelOnServer(model || '').catch(() => null);
    if (settings) {
      setCustomModels(settings.models);
      setHiddenPresetModels(settings.hiddenPresetModels);
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

  async function removePresetModel(model: string) {
    const settings = await hidePresetModelOnServer(model).catch(() => null);
    if (settings) {
      setCustomModels(settings.models);
      setHiddenPresetModels(settings.hiddenPresetModels);
    } else {
      setHiddenPresetModels((models) => Array.from(new Set([...models, model])));
    }
    const nextConfig = (() => {
      const config = llmConfig;
      if (config.model !== model) return config;
      return { ...config, model: '' };
    })();
    setLlmConfig(nextConfig);
    saveLlmConfig(nextConfig);
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
                  onClick={() => void removePresetModel(model)}
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
                  placeholder="sk-… 或 OpenRouter key"
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
        <button
          className="modal-btn danger settings-secondary-action"
          onClick={async () => {
            clearLlmConfig();
            setLlmConfig({ apiKey: undefined, apiUrl: undefined, model: undefined });
            const settings = await saveSelectedModelOnServer('').catch(() => null);
            if (settings) {
              setCustomModels(settings.models);
              setHiddenPresetModels(settings.hiddenPresetModels);
            }
            setLlmSaved(true);
            safeTimeout(() => setLlmSaved(false), 2000);
          }}
        >
          清除本地 LLM 凭据
        </button>
        <label
          className="settings-field-row"
          style={{ marginTop: 8, fontSize: 13, color: 'var(--text-secondary)' }}
        >
          <input
            type="checkbox"
            checked={llmRemember}
            onChange={(e) => {
              setLlmRemember(e.target.checked);
            }}
          />
          记住凭据（否则关闭浏览器后清除）
        </label>
      </div>

      {/* 模型运行记忆 */}
      <div className="settings-tab-divider" />

      <div className="settings-card-head">
        <div className="settings-card-icon">
          <Icon.Sparkle />
        </div>
        <div>
          <div className="settings-card-title">模型运行记忆</div>
          <div className="settings-card-desc">近 14 天模型成本、token 和失败调用。</div>
        </div>
      </div>

      <div className="settings-tool-row settings-card-head-adjacent">
        <div>
          <div className="settings-tool-title">
            {usage
              ? `${usage.totals.runs} 次调用 · ${formatUsd(usage.totals.costUsd)}`
              : '暂无调用记录'}
          </div>
          <div className="settings-card-desc">
            {usage
              ? `${formatCompactNumber(usage.totals.inputTokens + usage.totals.outputTokens)} tokens · 平均 ${
                  usage.totals.avgLatencyMs ? Math.round(usage.totals.avgLatencyMs) : 0
                }ms`
              : '等待服务端产生 model_runs 记录'}
          </div>
        </div>
        <button className="modal-btn" onClick={() => void loadUsage()} disabled={usageLoading}>
          {usageLoading ? '刷新中...' : '刷新'}
        </button>
      </div>

      {usage && usage.byModel.length > 0 && (
        <div className="settings-lint-results">
          {usage.byModel.slice(0, 4).map((item) => (
            <div key={item.model} className="settings-lint-finding">
              <div className="settings-lint-finding-type">{formatUsd(item.costUsd)}</div>
              <div className="settings-lint-finding-msg">
                {modelLabel(item.model)} · {item.runs} 次 ·{' '}
                {formatCompactNumber(item.inputTokens + item.outputTokens)} tokens
              </div>
            </div>
          ))}
          {usage.recentFailures.length > 0 && (
            <div className="settings-lint-finding last">
              <div className="settings-lint-finding-type">失败</div>
              <div className="settings-lint-finding-msg">
                {usage.recentFailures[0].task} · {modelLabel(usage.recentFailures[0].model)}
              </div>
            </div>
          )}
        </div>
      )}

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
