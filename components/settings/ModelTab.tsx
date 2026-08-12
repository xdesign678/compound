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
import { clearPrivateOfflineCache } from '@/lib/private-cache';
import { t, useLocale, type Locale } from '@/lib/i18n';
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

function formatCompactNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, { notation: 'compact' }).format(value);
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
  const { locale } = useLocale();
  const [llmConfig, setLlmConfig] = useState<LlmConfig>({});
  const [wikiModel, setWikiModel] = useState(DEFAULT_LLM_MODEL);
  const [askModel, setAskModel] = useState(DEFAULT_LLM_MODEL);
  const [customModels, setCustomModels] = useState<string[]>([]);
  const [hiddenPresetModels, setHiddenPresetModels] = useState<string[]>([]);
  const [llmAdvancedExpanded, setLlmAdvancedExpanded] = useState(false);
  const [llmRemember, setLlmRememberChoice] = useState(isLlmRemembered());
  const [llmSaved, setLlmSaved] = useState(false);
  const [llmStatus, setLlmStatus] = useState<StatusMessage | null>(null);
  const [confirmingLlmReset, setConfirmingLlmReset] = useState(false);
  const [adminToken, setAdminToken] = useState('');
  const [adminSaved, setAdminSaved] = useState(false);
  const [adminStatus, setAdminStatus] = useState<StatusMessage | null>(null);
  const [confirmingCacheClear, setConfirmingCacheClear] = useState(false);
  const [adminAction, setAdminAction] = useState<'logout' | 'clear' | null>(null);
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
        text: t('settings.usage.statusFailed'),
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
        text: t('settings.llm.statusApiUrlNeedsKey'),
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
          ? t('settings.llm.statusSavedRemembered')
          : t('settings.llm.statusSavedSession'),
      });
    } catch {
      setLlmStatus({
        tone: 'warning',
        text: t('settings.llm.statusSyncFailed'),
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
    setLlmStatus({ tone: 'info', text: t('settings.llm.statusCustomRemoved') });
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
    setLlmStatus({ tone: 'info', text: t('settings.llm.statusPresetHidden') });
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

        <div
          className="settings-preset-row"
          role="list"
          aria-label={t('settings.llm.presetListAria', { title: input.title })}
        >
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
                  aria-label={t('settings.llm.selectModel', { model: modelLabel(model) })}
                  onClick={() => input.onChange(model)}
                >
                  {modelLabel(model)}
                </button>
                {model !== DEFAULT_LLM_MODEL && (
                  <button
                    type="button"
                    className="settings-model-chip-delete"
                    aria-label={t('settings.llm.deleteModel', { model: modelLabel(model) })}
                    title={t('settings.llm.delete')}
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
                aria-label={t('settings.llm.selectModel', { model: modelLabel(model) })}
                onClick={() => input.onChange(model)}
              >
                {modelLabel(model)}
              </button>
              <button
                type="button"
                className="settings-model-chip-delete"
                aria-label={t('settings.llm.deleteModel', { model: modelLabel(model) })}
                title={t('settings.llm.delete')}
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
        text: t('settings.admin.statusSaved'),
      });
      safeTimeout(() => setAdminSaved(false), 2000);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('settings.admin.statusFailed');
      setAdminSaved(false);
      setAdminStatus({ tone: 'danger', text: message });
    }
  }

  async function clearAdmin(clearCache: boolean) {
    if (adminAction) return;
    setAdminAction(clearCache ? 'clear' : 'logout');
    setAdminStatus(null);
    try {
      await clearAdminToken().catch(() => undefined);
      if (clearCache) await clearPrivateOfflineCache();
      window.location.replace('/offline');
    } catch {
      setAdminStatus({ tone: 'danger', text: t('settings.admin.statusClearFailed') });
      setAdminAction(null);
    }
  }

  async function resetLlmToDefault() {
    setConfirmingLlmReset(false);
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
    setLlmStatus({ tone: 'success', text: t('settings.llm.statusResetDone') });
    safeTimeout(() => setLlmSaved(false), 2000);
  }

  return (
    <div className="settings-tab-content settings-model-tab">
      {/* LLM 配置 */}
      <div className="settings-card-head">
        <div className="settings-card-icon" aria-hidden="true">
          <Icon.Sparkle />
        </div>
        <div>
          <div className="settings-card-title">{t('settings.llm.title')}</div>
          <div className="settings-card-desc">{t('settings.llm.desc')}</div>
        </div>
      </div>

      <div className="settings-fields" aria-describedby="settings-model-credential-note">
        {renderModelSelector({
          title: t('settings.llm.wikiModel'),
          desc: t('settings.llm.wikiModelDesc'),
          value: wikiModel,
          onChange: setWikiModel,
          inputId: 'settings-wiki-model',
        })}

        {renderModelSelector({
          title: t('settings.llm.askModel'),
          desc: t('settings.llm.askModelDesc'),
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
            <span>{t('settings.llm.advanced')}</span>
            <span>
              {llmAdvancedExpanded ? t('settings.llm.collapse') : t('settings.llm.expand')}
            </span>
          </button>

          {!llmAdvancedExpanded && (
            <div className="settings-inline-note">{t('settings.llm.advancedNote')}</div>
          )}

          {llmAdvancedExpanded && (
            <>
              <label className="settings-field">
                <span>API Key</span>
                <input
                  type="password"
                  placeholder={t('settings.llm.apiKeyPlaceholder')}
                  value={llmConfig.apiKey || ''}
                  autoComplete="off"
                  aria-describedby="settings-model-credential-note"
                  onChange={(e) => setLlmConfig((c) => ({ ...c, apiKey: e.target.value }))}
                />
              </label>

              <label className="settings-field">
                <span>
                  API URL <em>{t('settings.llm.optional')}</em>
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
                  {t('settings.llm.apiUrlHint')}
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
          {llmSaved ? t('settings.llm.saved') : t('settings.llm.save')}
        </button>
        {confirmingLlmReset ? (
          <div
            className="settings-confirm-block settings-confirm-danger"
            role="group"
            aria-label={t('settings.llm.resetConfirmTitle')}
          >
            <p className="modal-desc">
              <strong>{t('settings.llm.resetConfirmTitle')}</strong>
              {t('settings.llm.resetConfirmDesc')}
            </p>
            <button
              className="modal-btn primary danger-confirm"
              type="button"
              onClick={() => void resetLlmToDefault()}
            >
              {t('settings.llm.resetConfirmAction')}
            </button>
            <button
              className="modal-btn"
              type="button"
              onClick={() => setConfirmingLlmReset(false)}
            >
              {t('settings.llm.cancel')}
            </button>
          </div>
        ) : (
          <button
            className="modal-btn danger settings-secondary-action"
            type="button"
            onClick={() => setConfirmingLlmReset(true)}
          >
            {t('settings.llm.reset')}
          </button>
        )}
        <label className="settings-field-row settings-field-row-help">
          <input
            type="checkbox"
            checked={llmRemember}
            onChange={(e) => {
              setLlmRememberChoice(e.target.checked);
            }}
          />
          {t('settings.llm.remember')}
        </label>
        <div id="settings-model-credential-note" className="settings-inline-note">
          {t('settings.llm.credentialNote')}
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
          <div className="settings-card-title">{t('settings.usage.title')}</div>
          <div className="settings-card-desc">{t('settings.usage.desc')}</div>
        </div>
      </div>

      <div className="settings-tool-row settings-card-head-adjacent">
        <div>
          <div className="settings-tool-title">
            {usage
              ? t('settings.usage.summary', {
                  runs: usage.totals.runs,
                  cost: formatUsd(usage.totals.costUsd),
                })
              : t('settings.usage.empty')}
          </div>
          <div className="settings-card-desc">
            {usage
              ? t('settings.usage.tokens', {
                  tokens: formatCompactNumber(
                    usage.totals.inputTokens + usage.totals.outputTokens,
                    locale,
                  ),
                  latency: usage.totals.avgLatencyMs ? Math.round(usage.totals.avgLatencyMs) : 0,
                })
              : t('settings.usage.waiting')}
          </div>
        </div>
        <button
          className="modal-btn"
          type="button"
          onClick={() => void loadUsage()}
          disabled={usageLoading}
          aria-busy={usageLoading}
        >
          {usageLoading ? t('settings.usage.refreshing') : t('settings.usage.refresh')}
        </button>
      </div>
      <StatusNotice message={usageStatus} />

      {usage && usage.byModel.length > 0 && (
        <div
          className="settings-lint-results"
          role="list"
          aria-label={t('settings.usage.listAria')}
        >
          {usage.byModel.slice(0, 4).map((item) => (
            <div key={item.model} className="settings-lint-finding" role="listitem">
              <div className="settings-lint-finding-type">{formatUsd(item.costUsd)}</div>
              <div className="settings-lint-finding-msg">
                {t('settings.usage.item', {
                  model: modelLabel(item.model),
                  runs: item.runs,
                  tokens: formatCompactNumber(item.inputTokens + item.outputTokens, locale),
                })}
              </div>
            </div>
          ))}
          {usage.recentFailures.length > 0 && (
            <div className="settings-lint-finding last" role="listitem">
              <div className="settings-lint-finding-type">{t('settings.usage.failure')}</div>
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
          <div className="settings-card-title">{t('settings.admin.title')}</div>
          <div className="settings-card-desc">{t('settings.admin.desc')}</div>
        </div>
      </div>

      <div className="settings-fields">
        <label className="settings-field">
          <span>Admin Token</span>
          <input
            type="password"
            placeholder={t('settings.admin.placeholder')}
            value={adminToken}
            autoComplete="off"
            aria-describedby="settings-admin-token-note"
            onChange={(e) => setAdminToken(e.target.value)}
          />
          <span id="settings-admin-token-note" className="settings-field-hint">
            {t('settings.admin.hint')}
          </span>
        </label>

        <div className="settings-action-row">
          <button className="modal-btn primary" type="button" onClick={() => void saveAdmin()}>
            {adminSaved ? t('settings.llm.saved') : t('settings.admin.save')}
          </button>
          <button
            className="modal-btn settings-secondary-action"
            type="button"
            onClick={() => void clearAdmin(false)}
            disabled={adminAction !== null}
          >
            {adminAction === 'logout'
              ? t('settings.admin.loggingOut')
              : t('settings.admin.logoutKeep')}
          </button>
        </div>
        {confirmingCacheClear ? (
          <div
            className="settings-confirm-block settings-confirm-danger"
            role="group"
            aria-label={t('settings.admin.clearCacheConfirmTitle')}
          >
            <p className="modal-desc">
              <strong>{t('settings.admin.clearCacheConfirmTitle')}</strong>
              {t('settings.admin.clearCacheConfirmDesc')}
            </p>
            <button
              className="modal-btn primary danger-confirm"
              type="button"
              disabled={adminAction !== null}
              onClick={() => void clearAdmin(true)}
            >
              {adminAction === 'clear'
                ? t('settings.admin.clearingCache')
                : t('settings.admin.clearCacheConfirmAction')}
            </button>
            <button
              className="modal-btn"
              type="button"
              disabled={adminAction !== null}
              onClick={() => setConfirmingCacheClear(false)}
            >
              {t('settings.llm.cancel')}
            </button>
          </div>
        ) : (
          <button
            className="modal-btn danger settings-secondary-action"
            type="button"
            disabled={adminAction !== null}
            onClick={() => setConfirmingCacheClear(true)}
          >
            {t('settings.admin.logoutClearCache')}
          </button>
        )}
        <StatusNotice message={adminStatus} />
      </div>
    </div>
  );
}
