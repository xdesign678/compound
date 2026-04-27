/**
 * Obsidian 批量导入引擎
 * - 解析 frontmatter（仅提取 title/author，原文完整送入 LLM）
 * - 基于 path|size|mtime 指纹 + localStorage 实现断点续传
 * - 串行处理队列，失败跳过不阻塞，支持中途停止
 */
import { ingestSource } from './api-client';

const MANIFEST_KEY = 'obsidian-import-manifest';

export type FileStatus =
  | 'pending' // 未处理
  | 'duplicate' // 指纹已存在，跳过
  | 'running' // 正在处理
  | 'success' // 成功
  | 'failed' // 失败
  | 'skipped'; // 用户取消勾选

export interface ObsidianFile {
  id: string; // 会话内临时 id（= fingerprint）
  path: string; // 相对路径（webkitRelativePath 或 name）
  name: string; // 纯文件名
  title: string; // 推导标题：frontmatter.title > 文件名
  author?: string;
  size: number;
  lastModified: number;
  fingerprint: string; // path|size|mtime
  fileHandle: File; // 保存 File 对象引用，用到时再读全量
  status: FileStatus;
  selected: boolean;
  error?: string;
  newConcepts?: number;
  updatedConcepts?: number;
}

export interface ImportManifestEntry {
  sourceId: string;
  title: string;
  importedAt: number;
}

// -------- manifest (断点续传) --------

export function loadManifest(): Record<string, ImportManifestEntry> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(MANIFEST_KEY);
    return raw ? (JSON.parse(raw) as Record<string, ImportManifestEntry>) : {};
  } catch {
    return {};
  }
}

function saveManifestEntry(fingerprint: string, entry: ImportManifestEntry): void {
  const m = loadManifest();
  m[fingerprint] = entry;
  try {
    localStorage.setItem(MANIFEST_KEY, JSON.stringify(m));
  } catch {
    // quota exceeded, ignore silently
  }
}

export function clearManifest(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(MANIFEST_KEY);
}

export function getManifestSize(): number {
  return Object.keys(loadManifest()).length;
}

// -------- 解析 --------

function stripMdExtension(name: string): string {
  return name.replace(/\.md$/i, '');
}

/**
 * 极简 YAML frontmatter 解析 - 仅提取 title/author 两个常见字段。
 * 其他字段不处理，且原文中 frontmatter 会完整保留送入 LLM。
 */
function parseFrontmatter(raw: string): { title?: string; author?: string } {
  const match = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n/);
  if (!match) return {};
  const out: { title?: string; author?: string } = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.+?)\s*$/);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    let val = kv[2].trim();
    // 跳过数组/对象等复杂类型
    if (val.startsWith('[') || val.startsWith('{')) continue;
    // 去除成对引号
    val = val.replace(/^["'](.*)["']$/, '$1').trim();
    if (!val) continue;
    if (key === 'title') out.title = val;
    else if (key === 'author' || key === 'authors') out.author = val;
  }
  return out;
}

/**
 * 过滤文件列表：仅保留 .md，排除 Obsidian 元数据目录
 */
export function filterObsidianFiles(list: FileList | File[]): File[] {
  const arr = Array.from(list);
  return arr.filter((f) => {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    if (rel.includes('/.obsidian/') || rel.startsWith('.obsidian/')) return false;
    if (rel.includes('/.trash/') || rel.startsWith('.trash/')) return false;
    if (rel.includes('/node_modules/')) return false;
    return /\.md$/i.test(f.name);
  });
}

/**
 * 将浏览器 File 对象转换为 ObsidianFile。只读取文件头部（约 2KB）解析 frontmatter。
 */
export async function readObsidianFile(file: File): Promise<ObsidianFile> {
  const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;

  // 避免内存泄漏：只读前 2048 字节解析 frontmatter
  const slice = file.slice(0, 2048);
  const headText = await slice.text();
  const fm = parseFrontmatter(headText);

  const fingerprint = `${path}|${file.size}|${file.lastModified}`;
  const manifest = loadManifest();
  const dup = !!manifest[fingerprint];
  const title = (fm.title || stripMdExtension(file.name)).trim();

  return {
    id: fingerprint,
    path,
    name: file.name,
    title: title || file.name,
    author: fm.author,
    size: file.size,
    lastModified: file.lastModified,
    fingerprint,
    fileHandle: file, // 存引用
    status: dup ? 'duplicate' : 'pending',
    selected: !dup,
  };
}

/**
 * 批量读文件（在主线程串行读取，几百个 md 文件几十毫秒到几秒量级）
 */
export async function readObsidianBatch(files: File[]): Promise<ObsidianFile[]> {
  const out: ObsidianFile[] = [];
  for (const f of files) {
    try {
      out.push(await readObsidianFile(f));
    } catch {
      // 读取失败的跳过
    }
  }
  // 按路径排序，便于浏览
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

// -------- 运行队列 --------

export interface RunQueueOptions {
  files: ObsidianFile[];
  onUpdate: (file: ObsidianFile, newIds?: string[]) => void;
  shouldStop: () => boolean;
}

/**
 * 串行执行导入队列。每次处理一个文件：
 * 1. 跳过 non-pending / non-selected
 * 2. 标记 running → 回调
 * 3. 调用 ingestSource（会走 LLM）
 * 4. 成功写 manifest，失败记录 error
 * 5. 再次回调
 */
export async function runImportQueue({
  files,
  onUpdate,
  shouldStop,
}: RunQueueOptions): Promise<void> {
  for (const f of files) {
    if (shouldStop()) return;
    if (!f.selected || f.status !== 'pending') continue;

    const running: ObsidianFile = { ...f, status: 'running' };
    onUpdate(running);

    try {
      // 真正需要时再读取完整内容送给大模型
      const fullText = await running.fileHandle.text();
      const result = await ingestSource({
        title: running.title,
        type: 'file',
        author: running.author,
        rawContent: fullText,
        externalKey: `obsidian:${running.path}|${running.size}`,
      });
      saveManifestEntry(running.fingerprint, {
        sourceId: result.sourceId,
        title: running.title,
        importedAt: Date.now(),
      });
      onUpdate(
        {
          ...running,
          status: 'success',
          newConcepts: result.newConceptIds.length,
          updatedConcepts: result.updatedConceptIds.length,
        },
        result.newConceptIds,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      onUpdate({
        ...running,
        status: 'failed',
        error: msg.slice(0, 200),
      });
    }
  }
}
