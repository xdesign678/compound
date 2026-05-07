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
  | 'settings.language.en';

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
};
