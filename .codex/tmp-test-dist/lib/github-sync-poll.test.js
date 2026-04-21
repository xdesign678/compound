"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const github_sync_poll_1 = require("./github-sync-poll");
(0, node_test_1.default)('retries transient 502 poll failures before marking sync as failed', () => {
    const plan = (0, github_sync_poll_1.getPollFailurePlan)({
        status: 502,
        message: '状态查询失败 (502): Bad Gateway',
        consecutiveFailures: 0,
    });
    strict_1.default.equal(plan.shouldRetry, true);
    strict_1.default.equal(plan.nextFailureCount, 1);
    strict_1.default.match(plan.userMessage, /正在重试/);
});
(0, node_test_1.default)('stops retrying after reaching the retry limit', () => {
    const plan = (0, github_sync_poll_1.getPollFailurePlan)({
        status: 502,
        message: '状态查询失败 (502): Bad Gateway',
        consecutiveFailures: 2,
    });
    strict_1.default.equal(plan.shouldRetry, false);
    strict_1.default.equal(plan.nextFailureCount, 3);
});
(0, node_test_1.default)('does not retry non-transient poll errors', () => {
    const plan = (0, github_sync_poll_1.getPollFailurePlan)({
        status: 404,
        message: '状态查询失败 (404): job not found',
        consecutiveFailures: 0,
    });
    strict_1.default.equal(plan.shouldRetry, false);
    strict_1.default.equal(plan.nextFailureCount, 1);
});
