"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPollFailurePlan = getPollFailurePlan;
const TRANSIENT_STATUS_CODES = new Set([429, 502, 503, 504]);
const DEFAULT_RETRY_LIMIT = 3;
const DEFAULT_RETRY_DELAY_MS = 1500;
function getPollFailurePlan(input) {
    const nextFailureCount = input.consecutiveFailures + 1;
    const retryLimit = input.retryLimit ?? DEFAULT_RETRY_LIMIT;
    const shouldRetry = isTransientPollFailure(input.status, input.message) && nextFailureCount < retryLimit;
    return {
        shouldRetry,
        nextFailureCount,
        retryDelayMs: DEFAULT_RETRY_DELAY_MS,
        userMessage: shouldRetry
            ? `状态查询暂时失败，正在重试（${nextFailureCount}/${retryLimit - 1}）`
            : input.message,
    };
}
function isTransientPollFailure(status, message) {
    if (typeof status === 'number' && TRANSIENT_STATUS_CODES.has(status)) {
        return true;
    }
    return /bad gateway|gateway timeout|service unavailable|failed to fetch|fetch failed|networkerror|econnreset/i.test(message);
}
