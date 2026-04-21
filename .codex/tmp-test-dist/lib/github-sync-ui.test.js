"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const github_sync_ui_1 = require("./github-sync-ui");
(0, node_test_1.default)('highlights the scan step while repository scan is running', () => {
    const items = (0, github_sync_ui_1.buildSyncStageItems)({
        phase: 'running',
        pulling: false,
        job: {
            status: 'running',
            total: 0,
            done: 0,
            failed: 0,
            current: '扫描 GitHub 仓库…',
        },
    });
    strict_1.default.deepEqual(items.map((item) => [item.id, item.status]), [
        ['scan', 'current'],
        ['plan', 'upcoming'],
        ['process', 'upcoming'],
        ['pull', 'upcoming'],
    ]);
});
(0, node_test_1.default)('highlights the planning step while diffing local changes', () => {
    const items = (0, github_sync_ui_1.buildSyncStageItems)({
        phase: 'running',
        pulling: false,
        job: {
            status: 'running',
            total: 95,
            done: 0,
            failed: 0,
            current: '已扫描 95 个文件，正在比对本地差异…',
        },
    });
    strict_1.default.equal(items[1]?.status, 'current');
    strict_1.default.equal(items[0]?.status, 'done');
});
(0, node_test_1.default)('extracts current file counter and path from processing label', () => {
    const display = (0, github_sync_ui_1.getCurrentFileDisplay)('[42/95] 脑科学与神经科学/决策与偏见/典型性偏好.md');
    strict_1.default.deepEqual(display, {
        counter: '42 / 95',
        path: '脑科学与神经科学/决策与偏见/典型性偏好.md',
    });
});
(0, node_test_1.default)('highlights pull stage after server sync is done and local pull is running', () => {
    const items = (0, github_sync_ui_1.buildSyncStageItems)({
        phase: 'done',
        pulling: true,
        job: {
            status: 'done',
            total: 95,
            done: 94,
            failed: 1,
            current: null,
        },
    });
    strict_1.default.deepEqual(items.map((item) => item.status), ['done', 'done', 'done', 'current']);
});
