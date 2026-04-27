'use client';

import { type PipelineStage } from './types';

interface Props {
  stages: PipelineStage[];
  /** Called when a stage cell is clicked — used to filter the file table. */
  onSelect?: (stage: string) => void;
  selected?: string | null;
}

function describeStage(s: PipelineStage): { tone: string; main: string; detail: string } {
  if (s.failed > 0) {
    return {
      tone: 'failed',
      main: `${s.failed} 失败`,
      detail: `成功 ${s.succeeded} · 排队 ${s.queued} · 运行 ${s.running}`,
    };
  }
  if (s.running > 0) {
    return {
      tone: 'running',
      main: `${s.running} 运行中`,
      detail: `成功 ${s.succeeded} · 排队 ${s.queued}`,
    };
  }
  if (s.queued > 0) {
    return {
      tone: 'queued',
      main: `${s.queued} 排队`,
      detail: `成功 ${s.succeeded}`,
    };
  }
  if (s.total === 0) {
    return { tone: 'idle', main: '空', detail: '尚无任务' };
  }
  return { tone: 'done', main: '完成', detail: `成功 ${s.succeeded}` };
}

export default function PipelineStrip({ stages, onSelect, selected }: Props) {
  return (
    <div className="ops-pipeline" role="list" aria-label="分析流水线">
      {stages.map((stage, i) => {
        const view = describeStage(stage);
        const isSelected = selected === stage.stage;
        const Tag = onSelect ? 'button' : 'div';
        return (
          <Tag
            key={stage.stage}
            type={onSelect ? 'button' : undefined}
            role="listitem"
            className={`ops-pipeline-step tone-${view.tone}${isSelected ? ' selected' : ''}`}
            onClick={onSelect ? () => onSelect(stage.stage) : undefined}
            title={`${stage.label}\n成功 ${stage.succeeded} · 失败 ${stage.failed} · 运行 ${stage.running} · 排队 ${stage.queued} · 跳过 ${stage.skipped} · 取消 ${stage.cancelled}`}
          >
            <span className="ops-pipeline-step-index">{i + 1}</span>
            <span className="ops-pipeline-step-body">
              <strong>{stage.label}</strong>
              <em>{view.main}</em>
              <small>{view.detail}</small>
            </span>
            <span className="ops-pipeline-step-bar" aria-hidden="true">
              {stage.total > 0 ? (
                <>
                  <span
                    className="seg seg-done"
                    style={{ width: `${(stage.succeeded / stage.total) * 100}%` }}
                  />
                  <span
                    className="seg seg-running"
                    style={{ width: `${(stage.running / stage.total) * 100}%` }}
                  />
                  <span
                    className="seg seg-queued"
                    style={{ width: `${(stage.queued / stage.total) * 100}%` }}
                  />
                  <span
                    className="seg seg-failed"
                    style={{ width: `${(stage.failed / stage.total) * 100}%` }}
                  />
                </>
              ) : null}
            </span>
          </Tag>
        );
      })}
    </div>
  );
}
