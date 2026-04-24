export interface CategorizeProgressSummary {
  total: number;
  failed: number;
  errors: string[];
}

export function formatCategorizeCompletionMessage(result: CategorizeProgressSummary): string {
  const failed = Math.max(0, result.failed);
  return failed > 0
    ? `归类完成，处理了 ${result.total} 条，失败 ${failed} 条`
    : `归类完成，处理了 ${result.total} 条`;
}
