'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
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
  saveSelectedModelsOnServer,
  setLlmRemember as persistLlmRemember,
} from '@/lib/llm-config';
import { DEFAULT_LLM_MODEL } from '@/lib/model-defaults';
import { clearAdminToken, getAdminToken, saveAdminToken } from '@/lib/admin-auth-client';
import type { LlmConfig } from '@/lib/types';
import { Icon } from '../Icons';

type StatusTone = 'success' | 'warning' | 'danger' | 'info';

interface StatusMessage {
  tone: StatusTone;
  text: string;
}

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

function StatusNotice({ message }: { message: StatusMessage | null }) {
  if (!message) return null;
  const liveMode = message.tone === 'danger' ? 'assertive' : 'polite';
  return (
    <div
      className={`settings-status settings-status-${message.tone}`}
      role={message.tone === 'danger' ? 'alert' : 'status'}
      aria-live={liveMode}
    >
      {message.text}
    </div>
  );
}

export function ModelTab() {
  const [llmConfig, setLlmConfig] = useState<LlmConfig>({});
  const [wikiModel, setWikiModel] = useState(DEFAULT_LLM_MODEL);
  const [askModel, setAskModel] = useState(DEFAULT_LLM_MODEL);
  const [customModels, setCustomModels] = useState<string[]>([]);
  const [hiddenPresetModels, setHiddenPresetModels] = useState<string[]>([]);
  const [llmAdvancedExpanded, setLlmAdvancedExpanded] = useState(false);
  const [llmRemember, setLlmRememberChoice] = useState(isLlmRemembered());
  const [llmSaved, setLlmSaved] = useState(false);
  const [llmStatus, setLlmStatus] = useState<StatusMessage | null>(null);
  const [adminToken, setAdminToken] = useState('');
  const [adminSaved, setAdminSaved] = useState(false);
  const [adminStatus, setAdminStatus] = useState<StatusMessage | null>(null);
  const [usage, setUsage] = useState<ModelUsageSummary | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageStatus, setUsageStatus] = useState<StatusMessage | null>(null);
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
        const selectedWikiModel = settings.selectedWikiModel || DEFAULT_LLM_MODEL;
        const selectedAskModel =
          settings.selectedAskModel || settings.selectedModel || DEFAULT_LLM_MODEL;
        setWikiModel(selectedWikiModel);
        setAskModel(selectedAskModel);
        setLlmConfig({
          ...localConfig,
          model: selectedAskModel,
          askModel: selectedAskModel,
          wikiModel: selectedWikiModel,
        });
      })
      .catch(() => {
        setCustomModels([]);
        setHiddenPresetModels([]);
        setWikiModel(localConfig.wikiModel || DEFAULT_LLM_MODEL);
        setAskModel(localConfig.askModel || localConfig.model || DEFAULT_LLM_MODEL);
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
      setUsageStatus(null);
    } catch {
      setUsage(null);
      setUsageStatus({
        tone: 'warning',
        text: '无法读取模型运行记录。请确认访问保护已登录，或稍后重试。',
      });
    } finally {
      setUsageLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsage();
  }, [loadUsage]);

  async function saveLlm() {
    const selectedWikiModel = wikiModel.trim() || DEFAULT_LLM_MODEL;
    const selectedAskModel = askModel.trim() || DEFAULT_LLM_MODEL;
    const nextConfig: LlmConfig = {
      model: selectedAskModel,
      askModel: selectedAskModel,
      wikiModel: selectedWikiModel,
      apiKey: llmConfig.apiKey?.trim() || undefined,
      apiUrl: llmConfig.apiUrl?.trim() || undefined,
    };

    if (nextConfig.apiUrl && !nextConfig.apiKey) {
      setLlmStatus({
        tone: 'danger',
        text: '自定义 API URL 需要同时填写 API Key，否则请求会被阻止。',
      });
      return;
    }

    persistLlmRemember(llmRemember);
    saveLlmConfig(nextConfig);
    setLlmConfig(nextConfig);
    setWikiModel(selectedWikiModel);
    setAskModel(selectedAskModel);

    try {
      const modelsToRemember = Array.from(new Set([selectedWikiModel, selectedAskModel]));
      for (const model of modelsToRemember) {
        const models = await rememberCustomModelOnServer(model);
        setCustomModels(models);
      }
      const settings = await saveSelectedModelsOnServer({
        wikiModel: selectedWikiModel,
        askModel: selectedAskModel,
      });
      setCustomModels(settings.models);
      setHiddenPresetModels(settings.hiddenPresetModels);
      setLlmStatus({
        tone: 'success',
        text: llmRemember
          ? '模型配置已保存。API Key 会保存在当前浏览器。'
          : '模型配置已保存。关闭浏览器后会清除 API Key。',
      });
    } catch {
      setLlmStatus({
        tone: 'warning',
        text: '本地配置已保存，但服务端模型列表同步失败。稍后可重试保存。',
      });
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
      if (config.model !== model && config.askModel !== model && config.wikiModel !== model) {
        return config;
      }
      const next = {
        ...config,
        model: config.model === model ? DEFAULT_LLM_MODEL : config.model,
        askModel: config.askModel === model ? DEFAULT_LLM_MODEL : config.askModel,
        wikiModel: config.wikiModel === model ? DEFAULT_LLM_MODEL : config.wikiModel,
      };
      saveLlmConfig(next);
      return next;
    });
    if (wikiModel === model) setWikiModel(DEFAULT_LLM_MODEL);
    if (askModel === model) setAskModel(DEFAULT_LLM_MODEL);
    setLlmStatus({ tone: 'info', text: '已从当前浏览器移除这个自定义模型。' });
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
      if (config.model !== model && config.askModel !== model && config.wikiModel !== model) {
        return config;
      }
      return {
        ...config,
        model: config.model === model ? DEFAULT_LLM_MODEL : config.model,
        askModel: config.askModel === model ? DEFAULT_LLM_MODEL : config.askModel,
        wikiModel: config.wikiModel === model ? DEFAULT_LLM_MODEL : config.wikiModel,
      };
    })();
    setLlmConfig(nextConfig);
    saveLlmConfig(nextConfig);
    if (wikiModel === model) setWikiModel(DEFAULT_LLM_MODEL);
    if (askModel === model) setAskModel(DEFAULT_LLM_MODEL);
    setLlmStatus({ tone: 'info', text: '已隐藏该预设模型。可重新输入模型名再保存。' });
  }

  function renderModelSelector(input: {
    title: string;
    desc: string;
    value: string;
    onChange: (value: string) => void;
    inputId: string;
  }) {
    return (
      <div className="settings-model-group">
        <label className="settings-field" htmlFor={input.inputId}>
          <span>{input.title}</span>
          <input
            id={input.inputId}
            type="text"
            placeholder={DEFAULT_LLM_MODEL}
            value={input.value}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => input.onChange(e.target.value)}
          />
          <span className="settings-field-hint">{input.desc}</span>
        </label>

        <div className="settings-preset-row" role="list" aria-label={`${input.title}可选模型`}>
          {PRESET_MODELS.map((item) => item.value)
            .filter((model) => !hiddenPresetModels.includes(model))
            .map((model) => (
              <span
                key={model}
                role="listitem"
                className={`settings-preset settings-model-chip${input.value === model ? ' active' : ''}`}
                title={model}
              >
                <button
                  type="button"
                  aria-pressed={input.value === model}
                  aria-label={`选择模型 ${modelLabel(model)}`}
                  onClick={() => input.onChange(model)}
                >
                  {modelLabel(model)}
                </button>
                {model !== DEFAULT_LLM_MODEL && (
                  <button
                    type="button"
                    className="settings-model-chip-delete"
                    aria-label={`删除模型 ${modelLabel(model)}`}
                    title="删除"
                    onClick={() => void removePresetModel(model)}
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
          {customModels.map((model) => (
            <span
              key={model}
              role="listitem"
              className={`settings-preset settings-model-chip${input.value === model ? ' active' : ''}`}
              title={model}
            >
              <button
                type="button"
                aria-pressed={input.value === model}
                aria-label={`选择模型 ${modelLabel(model)}`}
                onClick={() => input.onChange(model)}
              >
                {modelLabel(model)}
              </button>
              <button
                type="button"
                className="settings-model-chip-delete"
                aria-label={`删除模型 ${modelLabel(model)}`}
                title="删除"
                onClick={() => void removeCustomModel(model)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      </div>
    );
  }

  async function saveAdmin() {
    try {
      await saveAdminToken(adminToken);
      setAdminToken('');
      setAdminSaved(true);
      setAdminStatus({
        tone: 'success',
        text: '访问保护已登录；同源请求会自动使用服务端 httpOnly Cookie。',
      });
      safeTimeout(() => setAdminSaved(false), 2000);
    } catch (err) {
      const message = err instanceof Error ? err.message : '访问保护登录失败';
      setAdminSaved(false);
      setAdminStatus({ tone: 'danger', text: message });
    }
  }

  async function clearAdmin() {
    await clearAdminToken();
    setAdminToken('');
    setAdminSaved(true);
    setAdminStatus({ tone: 'success', text: '已退出访问保护，并清理旧版本地访问密钥。' });
    safeTimeout(() => setAdminSaved(false), 2000);
  }

  return (
    <div className="settings-tab-content settings-model-tab">
      {/* LLM 配置 */}
      <div className="settings-card-head">
        <div className="settings-card-icon" aria-hidden="true">
          <Icon.Sparkle />
        </div>
        <div>
          <div className="settings-card-title">LLM 配置</div>
          <div className="settings-card-desc">
            Wiki 生成和搜索问答可以分别设置模型；默认使用 DeepSeek V4 Flash。
          </div>
        </div>
      </div>

      <div className="settings-fields" aria-describedby="settings-model-credential-note">
        {renderModelSelector({
          title: 'Wiki 生成模型',
          desc: '用于 GitHub 文档同步、概念抽取、摘要和关系整理。',
          value: wikiModel,
          onChange: setWikiModel,
          inputId: 'settings-wiki-model',
        })}

        {renderModelSelector({
          title: '搜索问答模型',
          desc: '用于 Ask 页搜索问答、检索改写和答案生成。',
          value: askModel,
          onChange: setAskModel,
          inputId: 'settings-ask-model',
        })}

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
                  autoComplete="off"
                  aria-describedby="settings-model-credential-note"
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
                  autoComplete="off"
                  spellCheck={false}
                  aria-describedby="settings-model-api-url-note"
                  onChange={(e) => setLlmConfig((c) => ({ ...c, apiUrl: e.target.value }))}
                />
                <span id="settings-model-api-url-note" className="settings-field-hint">
                  自定义 URL 只允许公开 HTTPS 地址，并且必须配套 API Key。
                </span>
              </label>
            </>
          )}
        </div>

        <button
          className="modal-btn primary settings-primary-action"
          type="button"
          onClick={() => void saveLlm()}
        >
          {llmSaved ? '已保存 ✓' : '保存配置'}
        </button>
        <button
          className="modal-btn danger settings-secondary-action"
          type="button"
          onClick={async () => {
            clearLlmConfig();
            setWikiModel(DEFAULT_LLM_MODEL);
            setAskModel(DEFAULT_LLM_MODEL);
            setLlmConfig({
              apiKey: undefined,
              apiUrl: undefined,
              model: DEFAULT_LLM_MODEL,
              askModel: DEFAULT_LLM_MODEL,
              wikiModel: DEFAULT_LLM_MODEL,
            });
            const settings = await saveSelectedModelsOnServer({
              wikiModel: DEFAULT_LLM_MODEL,
              askModel: DEFAULT_LLM_MODEL,
            }).catch(() => null);
            if (settings) {
              setCustomModels(settings.models);
              setHiddenPresetModels(settings.hiddenPresetModels);
            }
            setLlmSaved(true);
            setLlmStatus({ tone: 'success', text: '已恢复默认模型，并清除当前浏览器凭据。' });
            safeTimeout(() => setLlmSaved(false), 2000);
          }}
        >
          恢复默认模型并清除凭据
        </button>
        <label className="settings-field-row settings-field-row-help">
          <input
            type="checkbox"
            checked={llmRemember}
            onChange={(e) => {
              setLlmRememberChoice(e.target.checked);
            }}
          />
          记住凭据（否则关闭浏览器后清除）
        </label>
        <div id="settings-model-credential-note" className="settings-inline-note">
          默认走服务端配置；只有填写 API Key 时，当前浏览器才会保存覆盖凭据。
        </div>
        <StatusNotice message={llmStatus} />
      </div>

      {/* 模型运行记忆 */}
      <div className="settings-tab-divider" />

      <div className="settings-card-head">
        <div className="settings-card-icon" aria-hidden="true">
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
        <button
          className="modal-btn"
          type="button"
          onClick={() => void loadUsage()}
          disabled={usageLoading}
          aria-busy={usageLoading}
        >
          {usageLoading ? '刷新中...' : '刷新'}
        </button>
      </div>
      <StatusNotice message={usageStatus} />

      {usage && usage.byModel.length > 0 && (
        <div className="settings-lint-results" role="list" aria-label="模型运行记录">
          {usage.byModel.slice(0, 4).map((item) => (
            <div key={item.model} className="settings-lint-finding" role="listitem">
              <div className="settings-lint-finding-type">{formatUsd(item.costUsd)}</div>
              <div className="settings-lint-finding-msg">
                {modelLabel(item.model)} · {item.runs} 次 ·{' '}
                {formatCompactNumber(item.inputTokens + item.outputTokens)} tokens
              </div>
            </div>
          ))}
          {usage.recentFailures.length > 0 && (
            <div className="settings-lint-finding last" role="listitem">
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
        <div className="settings-card-icon" aria-hidden="true">
          <Icon.Settings />
        </div>
        <div>
          <div className="settings-card-title">访问保护</div>
          <div className="settings-card-desc">
            访问保护由服务端 Cookie 处理；这里可清理旧版浏览器凭据。
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
            autoComplete="off"
            aria-describedby="settings-admin-token-note"
            onChange={(e) => setAdminToken(e.target.value)}
          />
          <span id="settings-admin-token-note" className="settings-field-hint">
            访问保护由服务端 Cookie 处理，不会把 Admin Token 写入本地存储。
          </span>
        </label>

        <div className="settings-action-row">
          <button className="modal-btn primary" type="button" onClick={() => void saveAdmin()}>
            {adminSaved ? '已保存 ✓' : '保存访问密钥'}
          </button>
          <button
            className="modal-btn settings-secondary-action"
            type="button"
            onClick={() => void clearAdmin()}
          >
            清除
          </button>
        </div>
        <StatusNotice message={adminStatus} />
      </div>
    </div>
  );
}
