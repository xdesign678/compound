/**
 * Boot-time crash recovery.
 *
 * Runs once per Node.js runtime startup (from `instrumentation.register()`) so
 * background runs/jobs left in `running` by a crash or restart are recovered
 * immediately — instead of waiting for a user to hit a status endpoint that
 * lazily triggers recovery as a side effect. Each step is isolated: one
 * failing recovery must never block the others or take down startup.
 *
 * Server-only.
 */
import { logger } from './server-logger';
import { repo } from './server-db';
import { recoverStaleAnalysisJobs, startAnalysisWorker } from './analysis-worker';
import { resumePendingRepairRuns } from './repair-worker';
import { resumePendingSelectionWikiRuns } from './selection-wiki-worker';
import { resumePendingLintRuns } from './lint-worker';
import { resumePendingCategoryWikiRuns } from './category-wiki-worker';

const STALE_SYNC_JOB_MAX_AGE_MS = 10 * 60 * 1000;

function runStep(step: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    logger.error('boot_recovery.step_failed', {
      step,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Recover every kind of stuck background run/job. Safe to call multiple times.
 */
export function runBootRecovery(): void {
  runStep('sync_jobs', () => {
    const recovered = repo.recoverStaleSyncJobs(STALE_SYNC_JOB_MAX_AGE_MS);
    if (recovered > 0) logger.info('boot_recovery.sync_jobs_recovered', { recovered });
  });
  runStep('analysis_jobs', () => {
    const recovery = recoverStaleAnalysisJobs();
    if (recovery.jobs > 0 || recovery.items > 0) {
      logger.info('boot_recovery.analysis_recovered', recovery);
    }
  });
  runStep('analysis_worker', () => {
    const worker = startAnalysisWorker('boot-recovery');
    if (worker.started) {
      logger.info('boot_recovery.analysis_worker_started', {
        activeWorkers: worker.activeWorkers,
        queued: worker.queued,
      });
    }
  });
  runStep('repair_runs', () => resumePendingRepairRuns());
  runStep('selection_wiki_runs', () => resumePendingSelectionWikiRuns());
  runStep('lint_runs', () => resumePendingLintRuns());
  runStep('category_wiki_runs', () => resumePendingCategoryWikiRuns());
}
