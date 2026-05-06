import type { SourceType } from './types';

export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  link: '链接',
  text: '文本',
  file: '文件',
  article: '文章',
  book: '书籍',
  pdf: 'PDF',
  gist: '代码片段',
};
