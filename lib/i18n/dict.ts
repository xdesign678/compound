export type Locale = 'zh-CN' | 'en';

export type I18nKey =
  | 'header.wiki.title'
  | 'header.wiki.subtitle.loading'
  | 'header.wiki.subtitle.ready'
  | 'header.sources.title'
  | 'header.sources.subtitle.loading'
  | 'header.sources.subtitle.ready'
  | 'header.ask.title'
  | 'header.ask.subtitle'
  | 'header.activity.title'
  | 'header.activity.subtitle'
  | 'header.back'
  | 'header.toc'
  | 'header.search.expand'
  | 'header.search'
  | 'header.githubSync'
  | 'header.syncConsole'
  | 'header.obsidianImport'
  | 'header.settings'
  | 'header.more'
  | 'tab.wiki'
  | 'tab.sources'
  | 'tab.ask'
  | 'tab.activity'
  | 'tab.navLabel'
  | 'tab.addSource'
  | 'toast.retrying'
  | 'toast.retry'
  | 'toast.close'
  | 'toast.offline'
  | 'toast.offlineWithTasks'
  | 'offlineBanner.text'
  | 'offlineBanner.hint'
  | 'offlineBanner.close'
  | 'settings.kicker'
  | 'settings.title'
  | 'settings.close'
  | 'settings.categories'
  | 'settings.general'
  | 'settings.model'
  | 'settings.data'
  | 'settings.language.title'
  | 'settings.language.desc'
  | 'settings.language.zh'
  | 'settings.language.en'
  | 'settings.language.aria'
  | 'settings.colorMode.title'
  | 'settings.colorMode.desc'
  | 'settings.colorMode.light'
  | 'settings.colorMode.dark'
  | 'settings.colorMode.system'
  | 'settings.fontSize.title'
  | 'settings.fontSize.desc'
  | 'settings.fontSize.optionAria'
  | 'settings.fontSize.xs'
  | 'settings.fontSize.sm'
  | 'settings.fontSize.md'
  | 'settings.fontSize.lg'
  | 'settings.fontSize.xl'
  | 'settings.lineHeight.title'
  | 'settings.lineHeight.desc'
  | 'settings.lineHeight.optionAria'
  | 'settings.lineHeight.compact'
  | 'settings.lineHeight.snug'
  | 'settings.lineHeight.standard'
  | 'settings.lineHeight.relaxed'
  | 'settings.lineHeight.loose'
  | 'settings.homeStyle.title'
  | 'settings.homeStyle.desc'
  | 'settings.homeStyle.feed'
  | 'settings.homeStyle.library'
  | 'settings.markdownBreaks.title'
  | 'settings.markdownBreaks.descLoose'
  | 'settings.markdownBreaks.descStrict'
  | 'settings.markdownBreaks.strict'
  | 'settings.markdownBreaks.loose'
  | 'settings.llm.title'
  | 'settings.llm.desc'
  | 'settings.llm.wikiModel'
  | 'settings.llm.wikiModelDesc'
  | 'settings.llm.askModel'
  | 'settings.llm.askModelDesc'
  | 'settings.llm.presetListAria'
  | 'settings.llm.selectModel'
  | 'settings.llm.deleteModel'
  | 'settings.llm.delete'
  | 'settings.llm.advanced'
  | 'settings.llm.expand'
  | 'settings.llm.collapse'
  | 'settings.llm.advancedNote'
  | 'settings.llm.optional'
  | 'settings.llm.apiKeyPlaceholder'
  | 'settings.llm.apiUrlHint'
  | 'settings.llm.save'
  | 'settings.llm.saved'
  | 'settings.llm.remember'
  | 'settings.llm.credentialNote'
  | 'settings.llm.reset'
  | 'settings.llm.resetConfirmTitle'
  | 'settings.llm.resetConfirmDesc'
  | 'settings.llm.resetConfirmAction'
  | 'settings.llm.cancel'
  | 'settings.llm.statusApiUrlNeedsKey'
  | 'settings.llm.statusSavedRemembered'
  | 'settings.llm.statusSavedSession'
  | 'settings.llm.statusSyncFailed'
  | 'settings.llm.statusCustomRemoved'
  | 'settings.llm.statusPresetHidden'
  | 'settings.llm.statusResetDone'
  | 'settings.usage.title'
  | 'settings.usage.desc'
  | 'settings.usage.summary'
  | 'settings.usage.tokens'
  | 'settings.usage.empty'
  | 'settings.usage.waiting'
  | 'settings.usage.refresh'
  | 'settings.usage.refreshing'
  | 'settings.usage.statusFailed'
  | 'settings.usage.listAria'
  | 'settings.usage.item'
  | 'settings.usage.failure'
  | 'settings.admin.title'
  | 'settings.admin.desc'
  | 'settings.admin.placeholder'
  | 'settings.admin.hint'
  | 'settings.admin.save'
  | 'settings.admin.clear'
  | 'settings.admin.statusSaved'
  | 'settings.admin.statusCleared'
  | 'settings.admin.statusFailed';

export const DEFAULT_LOCALE: Locale = 'zh-CN';

export const I18N_DICT: Record<I18nKey, Record<Locale, string>> = {
  'header.wiki.title': { 'zh-CN': '我的 Wiki', en: 'My Wiki' },
  'header.wiki.subtitle.loading': { 'zh-CN': '正在同步本地知识库', en: 'Syncing local wiki' },
  'header.wiki.subtitle.ready': {
    'zh-CN': '{conceptCount} 个概念 · {sourceCount} 份资料',
    en: '{conceptCount} concepts · {sourceCount} sources',
  },
  'header.sources.title': { 'zh-CN': '原始资料', en: 'Sources' },
  'header.sources.subtitle.loading': { 'zh-CN': '正在同步资料', en: 'Syncing sources' },
  'header.sources.subtitle.ready': {
    'zh-CN': '{sourceCount} 份 · AI 只读不改',
    en: '{sourceCount} sources · originals stay intact',
  },
  'header.ask.title': { 'zh-CN': '向 Wiki 提问', en: 'Ask Wiki' },
  'header.ask.subtitle': { 'zh-CN': '答案来自你的知识库', en: 'Answers from your wiki' },
  'header.activity.title': { 'zh-CN': 'Wiki 维护', en: 'Wiki Ops' },
  'header.activity.subtitle': { 'zh-CN': '健康检查与活动日志', en: 'Health checks and activity' },
  'header.back': { 'zh-CN': '返回', en: 'Back' },
  'header.toc': { 'zh-CN': '显示目录', en: 'Show outline' },
  'header.search.expand': { 'zh-CN': '展开搜索', en: 'Expand search' },
  'header.search': { 'zh-CN': '搜索', en: 'Search' },
  'header.githubSync': { 'zh-CN': '从 GitHub 同步', en: 'Sync from GitHub' },
  'header.syncConsole': { 'zh-CN': '同步控制台', en: 'Sync console' },
  'header.obsidianImport': { 'zh-CN': '从 Obsidian 批量导入', en: 'Import from Obsidian' },
  'header.settings': { 'zh-CN': '设置', en: 'Settings' },
  'header.more': { 'zh-CN': '更多操作', en: 'More actions' },
  'tab.wiki': { 'zh-CN': 'Wiki', en: 'Wiki' },
  'tab.sources': { 'zh-CN': '资料', en: 'Sources' },
  'tab.ask': { 'zh-CN': '问答', en: 'Ask' },
  'tab.activity': { 'zh-CN': '活动', en: 'Activity' },
  'tab.navLabel': { 'zh-CN': '主导航', en: 'Main navigation' },
  'tab.addSource': { 'zh-CN': '添加新资料', en: 'Add source' },
  'toast.retrying': { 'zh-CN': '重试中…', en: 'Retrying...' },
  'toast.retry': { 'zh-CN': '重试', en: 'Retry' },
  'toast.close': { 'zh-CN': '关闭', en: 'Close' },
  'toast.offline': { 'zh-CN': '离线中，写入已暂停', en: 'Offline. Writes are paused' },
  'toast.offlineWithTasks': {
    'zh-CN': '离线中，写入已暂停 · {count} 个任务待恢复',
    en: 'Offline. Writes are paused · {count} tasks waiting',
  },
  'offlineBanner.text': { 'zh-CN': '离线模式 · 仅本地查看', en: 'Offline mode · read-only' },
  'offlineBanner.hint': {
    'zh-CN': '写入操作（摄入 / 修复 / 归类）已暂停',
    en: 'Writes (ingest / repair / categorize) are paused',
  },
  'offlineBanner.close': { 'zh-CN': '关闭离线提示', en: 'Dismiss offline notice' },
  'settings.kicker': { 'zh-CN': 'Compound 设置', en: 'Compound settings' },
  'settings.title': { 'zh-CN': '设置', en: 'Settings' },
  'settings.close': { 'zh-CN': '关闭', en: 'Close' },
  'settings.categories': { 'zh-CN': '设置分类', en: 'Settings sections' },
  'settings.general': { 'zh-CN': '通用', en: 'General' },
  'settings.model': { 'zh-CN': '模型', en: 'Model' },
  'settings.data': { 'zh-CN': '数据', en: 'Data' },
  'settings.language.title': { 'zh-CN': '语言（实验性）', en: 'Language (experimental)' },
  'settings.language.desc': {
    'zh-CN': '只影响已迁移的顶部导航、提示和设置文案',
    en: 'Only migrated navigation, toasts, and settings copy change',
  },
  'settings.language.zh': { 'zh-CN': '中文', en: 'Chinese' },
  'settings.language.en': { 'zh-CN': '英文', en: 'English' },
  'settings.language.aria': { 'zh-CN': '界面语言', en: 'Interface language' },
  'settings.colorMode.title': { 'zh-CN': '颜色模式', en: 'Color mode' },
  'settings.colorMode.desc': {
    'zh-CN': '浅色、深色或跟随系统',
    en: 'Light, dark, or follow system',
  },
  'settings.colorMode.light': { 'zh-CN': '浅色', en: 'Light' },
  'settings.colorMode.dark': { 'zh-CN': '深色', en: 'Dark' },
  'settings.colorMode.system': { 'zh-CN': '系统', en: 'System' },
  'settings.fontSize.title': { 'zh-CN': '正文字号', en: 'Reading font size' },
  'settings.fontSize.desc': {
    'zh-CN': '调整 Wiki 和资料详情页阅读字号',
    en: 'Adjust the reading size on wiki and source pages',
  },
  'settings.fontSize.optionAria': { 'zh-CN': '字号: {label}', en: 'Font size: {label}' },
  'settings.fontSize.xs': { 'zh-CN': '小', en: 'XS' },
  'settings.fontSize.sm': { 'zh-CN': '较小', en: 'S' },
  'settings.fontSize.md': { 'zh-CN': '中', en: 'M' },
  'settings.fontSize.lg': { 'zh-CN': '较大', en: 'L' },
  'settings.fontSize.xl': { 'zh-CN': '大', en: 'XL' },
  'settings.lineHeight.title': { 'zh-CN': '行间距', en: 'Line height' },
  'settings.lineHeight.desc': {
    'zh-CN': '调整详情页正文行间距',
    en: 'Adjust body line height on detail pages',
  },
  'settings.lineHeight.optionAria': { 'zh-CN': '行间距: {label}', en: 'Line height: {label}' },
  'settings.lineHeight.compact': { 'zh-CN': '紧凑', en: 'Compact' },
  'settings.lineHeight.snug': { 'zh-CN': '偏紧', en: 'Snug' },
  'settings.lineHeight.standard': { 'zh-CN': '标准', en: 'Standard' },
  'settings.lineHeight.relaxed': { 'zh-CN': '宽松', en: 'Relaxed' },
  'settings.lineHeight.loose': { 'zh-CN': '舒展', en: 'Loose' },
  'settings.homeStyle.title': { 'zh-CN': '首页样式', en: 'Home style' },
  'settings.homeStyle.desc': {
    'zh-CN': '动态流或分类知识库',
    en: 'Feed or categorized library',
  },
  'settings.homeStyle.feed': { 'zh-CN': '动态流', en: 'Feed' },
  'settings.homeStyle.library': { 'zh-CN': '知识库', en: 'Library' },
  'settings.markdownBreaks.title': { 'zh-CN': 'Markdown 换行', en: 'Markdown line breaks' },
  'settings.markdownBreaks.descLoose': {
    'zh-CN': '宽松模式：单个换行即分段',
    en: 'Loose: a single line break starts a new paragraph',
  },
  'settings.markdownBreaks.descStrict': {
    'zh-CN': '严格模式：需空行才能分段',
    en: 'Strict: paragraphs need a blank line between them',
  },
  'settings.markdownBreaks.strict': { 'zh-CN': '严格', en: 'Strict' },
  'settings.markdownBreaks.loose': { 'zh-CN': '宽松', en: 'Loose' },
  'settings.llm.title': { 'zh-CN': 'LLM 配置', en: 'LLM configuration' },
  'settings.llm.desc': {
    'zh-CN': 'Wiki 生成和搜索问答可以分别设置模型；默认使用 DeepSeek V4 Flash。',
    en: 'Wiki generation and Ask can use separate models. Default: DeepSeek V4 Flash.',
  },
  'settings.llm.wikiModel': { 'zh-CN': 'Wiki 生成模型', en: 'Wiki generation model' },
  'settings.llm.wikiModelDesc': {
    'zh-CN': '用于 GitHub 文档同步、概念抽取、摘要和关系整理。',
    en: 'Used for GitHub doc sync, concept extraction, summaries, and relations.',
  },
  'settings.llm.askModel': { 'zh-CN': '搜索问答模型', en: 'Ask model' },
  'settings.llm.askModelDesc': {
    'zh-CN': '用于 Ask 页搜索问答、检索改写和答案生成。',
    en: 'Used for Ask Q&A, retrieval rewriting, and answer generation.',
  },
  'settings.llm.presetListAria': {
    'zh-CN': '{title}可选模型',
    en: 'Available models for {title}',
  },
  'settings.llm.selectModel': { 'zh-CN': '选择模型 {model}', en: 'Select model {model}' },
  'settings.llm.deleteModel': { 'zh-CN': '删除模型 {model}', en: 'Delete model {model}' },
  'settings.llm.delete': { 'zh-CN': '删除', en: 'Delete' },
  'settings.llm.advanced': { 'zh-CN': '高级配置', en: 'Advanced' },
  'settings.llm.expand': { 'zh-CN': '展开', en: 'Expand' },
  'settings.llm.collapse': { 'zh-CN': '收起', en: 'Collapse' },
  'settings.llm.advancedNote': {
    'zh-CN': 'API Key 与 API URL 默认跟随服务端配置。',
    en: 'API Key and API URL follow the server configuration by default.',
  },
  'settings.llm.optional': { 'zh-CN': '可选', en: 'Optional' },
  'settings.llm.apiKeyPlaceholder': {
    'zh-CN': 'sk-… 或 OpenRouter key',
    en: 'sk-… or an OpenRouter key',
  },
  'settings.llm.apiUrlHint': {
    'zh-CN': '自定义 URL 只允许公开 HTTPS 地址，并且必须配套 API Key。',
    en: 'Custom URLs must be public HTTPS addresses and require an API Key.',
  },
  'settings.llm.save': { 'zh-CN': '保存配置', en: 'Save configuration' },
  'settings.llm.saved': { 'zh-CN': '已保存 ✓', en: 'Saved ✓' },
  'settings.llm.remember': {
    'zh-CN': '记住凭据（否则关闭浏览器后清除）',
    en: 'Remember credentials (otherwise cleared when the browser closes)',
  },
  'settings.llm.credentialNote': {
    'zh-CN': '默认走服务端配置；只有填写 API Key 时，当前浏览器才会保存覆盖凭据。',
    en: 'Server config is used by default; this browser only stores override credentials when you enter an API Key.',
  },
  'settings.llm.reset': {
    'zh-CN': '恢复默认模型并清除凭据',
    en: 'Restore default model and clear credentials',
  },
  'settings.llm.resetConfirmTitle': {
    'zh-CN': '确认恢复默认模型并清除凭据。',
    en: 'Restore the default model and clear credentials?',
  },
  'settings.llm.resetConfirmDesc': {
    'zh-CN': '会清除当前浏览器保存的 API Key 与 API URL，Wiki 与问答模型恢复为默认。',
    en: 'This clears the API Key and API URL stored in this browser and restores the default models.',
  },
  'settings.llm.resetConfirmAction': { 'zh-CN': '确认恢复', en: 'Restore' },
  'settings.llm.cancel': { 'zh-CN': '取消', en: 'Cancel' },
  'settings.llm.statusApiUrlNeedsKey': {
    'zh-CN': '自定义 API URL 需要同时填写 API Key，否则请求会被阻止。',
    en: 'A custom API URL also requires an API Key, otherwise requests are blocked.',
  },
  'settings.llm.statusSavedRemembered': {
    'zh-CN': '模型配置已保存。API Key 会保存在当前浏览器。',
    en: 'Model configuration saved. The API Key stays in this browser.',
  },
  'settings.llm.statusSavedSession': {
    'zh-CN': '模型配置已保存。关闭浏览器后会清除 API Key。',
    en: 'Model configuration saved. The API Key is cleared when the browser closes.',
  },
  'settings.llm.statusSyncFailed': {
    'zh-CN': '本地配置已保存，但服务端模型列表同步失败。稍后可重试保存。',
    en: 'Saved locally, but syncing the server model list failed. Try saving again later.',
  },
  'settings.llm.statusCustomRemoved': {
    'zh-CN': '已删除这个自定义模型。',
    en: 'Custom model deleted.',
  },
  'settings.llm.statusPresetHidden': {
    'zh-CN': '已隐藏该预设模型。可重新输入模型名再保存。',
    en: 'Preset model hidden. Type the model name and save to add it back.',
  },
  'settings.llm.statusResetDone': {
    'zh-CN': '已恢复默认模型，并清除当前浏览器凭据。',
    en: 'Default model restored and browser credentials cleared.',
  },
  'settings.usage.title': { 'zh-CN': '模型运行记忆', en: 'Model run history' },
  'settings.usage.desc': {
    'zh-CN': '近 14 天模型成本、token 和失败调用。',
    en: 'Model cost, tokens, and failed calls over the last 14 days.',
  },
  'settings.usage.summary': { 'zh-CN': '{runs} 次调用 · {cost}', en: '{runs} calls · {cost}' },
  'settings.usage.tokens': {
    'zh-CN': '{tokens} tokens · 平均 {latency}ms',
    en: '{tokens} tokens · avg {latency}ms',
  },
  'settings.usage.empty': { 'zh-CN': '暂无调用记录', en: 'No calls yet' },
  'settings.usage.waiting': {
    'zh-CN': '等待服务端产生 model_runs 记录',
    en: 'Waiting for server-side model_runs records',
  },
  'settings.usage.refresh': { 'zh-CN': '刷新', en: 'Refresh' },
  'settings.usage.refreshing': { 'zh-CN': '刷新中…', en: 'Refreshing…' },
  'settings.usage.statusFailed': {
    'zh-CN': '无法读取模型运行记录。请确认访问保护已登录，或稍后重试。',
    en: 'Could not load model run history. Make sure access protection is signed in, or try again later.',
  },
  'settings.usage.listAria': { 'zh-CN': '模型运行记录', en: 'Model run records' },
  'settings.usage.item': {
    'zh-CN': '{model} · {runs} 次 · {tokens} tokens',
    en: '{model} · {runs} runs · {tokens} tokens',
  },
  'settings.usage.failure': { 'zh-CN': '失败', en: 'Failed' },
  'settings.admin.title': { 'zh-CN': '访问保护', en: 'Access protection' },
  'settings.admin.desc': {
    'zh-CN': '访问保护由服务端 Cookie 处理；这里可清理旧版浏览器凭据。',
    en: 'Access protection is handled by a server cookie; you can clear legacy browser credentials here.',
  },
  'settings.admin.placeholder': {
    'zh-CN': '与服务端 ADMIN_TOKEN 保持一致',
    en: 'Must match the server ADMIN_TOKEN',
  },
  'settings.admin.hint': {
    'zh-CN': '访问保护由服务端 Cookie 处理，不会把 Admin Token 写入本地存储。',
    en: 'Access protection uses a server cookie; the Admin Token is never written to local storage.',
  },
  'settings.admin.save': { 'zh-CN': '保存访问密钥', en: 'Save access token' },
  'settings.admin.clear': { 'zh-CN': '清除', en: 'Clear' },
  'settings.admin.statusSaved': {
    'zh-CN': '访问保护已登录；同源请求会自动使用服务端 httpOnly Cookie。',
    en: 'Signed in; same-origin requests automatically use the server httpOnly cookie.',
  },
  'settings.admin.statusCleared': {
    'zh-CN': '已退出访问保护，并清理旧版本地访问密钥。',
    en: 'Signed out of access protection and cleared legacy local tokens.',
  },
  'settings.admin.statusFailed': {
    'zh-CN': '访问保护登录失败',
    en: 'Access protection sign-in failed',
  },
};
