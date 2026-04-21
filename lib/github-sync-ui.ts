export type SyncViewPhase = 'idle' | 'starting' | 'running' | 'done' | 'failed';

export interface SyncViewJob {
  status: 'running' | 'done' | 'failed';
  total: number;
  done: number;
  failed: number;
  current: string | null;
}

export interface SyncStageItem {
  id: 'scan' | 'plan' | 'process' | 'pull';
  label: string;
  status: 'done' | 'current' | 'upcoming';
}

export function buildSyncStageItems(input: {
  phase: SyncViewPhase;
  pulling: boolean;
  job: SyncViewJob | null;
}): SyncStageItem[] {
  const active = inferActiveStage(input);
  const orderedIds: SyncStageItem['id'][] = ['scan', 'plan', 'process', 'pull'];

  return orderedIds.map((id, index) => {
    const activeIndex = orderedIds.indexOf(active);
    const status =
      index < activeIndex ? 'done' : index === activeIndex ? 'current' : 'upcoming';

    return {
      id,
      label: stageLabels[id],
      status,
    };
  });
}

export function getCurrentFileDisplay(current: string | null): { counter: string | null; path: string | null } {
  if (!current) return { counter: null, path: null };

  const match = current.match(/^\[(\d+)\/(\d+)\]\s+(.+)$/);
  if (!match) {
    return {
      counter: null,
      path: current,
    };
  }

  return {
    counter: `${match[1]} / ${match[2]}`,
    path: match[3],
  };
}

export function getSyncStatusCopy(input: {
  phase: SyncViewPhase;
  pulling: boolean;
  job: SyncViewJob | null;
  pollIssue: string | null;
  error: string | null;
}): { eyebrow: string; title: string; description: string } {
  if (input.phase === 'idle') {
    return {
      eyebrow: '等待开始',
      title: '准备从 GitHub 同步',
      description: '服务端会先扫描仓库，再只处理真正有变化的 Markdown 文件。',
    };
  }

  if (input.phase === 'starting') {
    return {
      eyebrow: '正在启动',
      title: '服务端正在建立同步任务',
      description: '通常只需几秒，建立后就会持续回传进度。',
    };
  }

  if (input.phase === 'failed') {
    return {
      eyebrow: '同步失败',
      title: '这次同步没有顺利完成',
      description: input.error || input.pollIssue || '请检查失败原因后重试。',
    };
  }

  if (input.phase === 'done') {
    if (input.pulling) {
      return {
        eyebrow: '正在收尾',
        title: '服务端已完成，正在拉取本地数据',
        description: '远端同步已经结束，正在把最新快照同步到当前设备。',
      };
    }

    return {
      eyebrow: '同步完成',
      title: '远端与本地已经完成同步',
      description: '你现在看到的是最新结果，可以直接关闭窗口继续使用。',
    };
  }

  return {
    eyebrow: '正在同步',
    title: '服务端正在处理远端 Markdown',
    description: input.pollIssue || '关闭窗口不会中断，同步会继续在后台完成。',
  };
}

const stageLabels: Record<SyncStageItem['id'], string> = {
  scan: '扫描仓库',
  plan: '比对差异',
  process: '正在处理',
  pull: '拉取本地',
};

function inferActiveStage(input: {
  phase: SyncViewPhase;
  pulling: boolean;
  job: SyncViewJob | null;
}): SyncStageItem['id'] {
  if (input.phase === 'idle' || input.phase === 'starting') return 'scan';
  if (input.phase === 'done' && input.pulling) return 'pull';
  if (input.phase === 'done' && !input.pulling) return 'pull';

  const current = input.job?.current || '';
  if (current.includes('扫描 GitHub 仓库')) return 'scan';
  if (current.includes('比对本地差异')) return 'plan';

  if (/^\[\d+\/\d+\]\s+.+/.test(current)) return 'process';
  if ((input.job?.done || 0) + (input.job?.failed || 0) > 0) return 'process';
  if ((input.job?.total || 0) > 0) return 'plan';

  return 'scan';
}
