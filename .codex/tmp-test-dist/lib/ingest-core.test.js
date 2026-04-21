"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const ingest_core_1 = require("./ingest-core");
(0, node_test_1.default)('caps existing concepts without throwing and keeps more relevant entries first', () => {
    const existing = Array.from({ length: 520 }, (_, index) => ({
        id: `c-${index}`,
        title: index === 519 ? '神经可塑性' : `概念 ${index}`,
        summary: index === 519 ? '和大脑学习强相关' : `普通概念 ${index}`,
    }));
    const picked = (0, ingest_core_1.pickExistingConceptsForPrompt)({
        sourceTitle: '神经可塑性笔记',
        sourceRawContent: '这篇文章讨论大脑学习、突触变化和神经可塑性。',
        existingConcepts: existing,
    });
    strict_1.default.equal(picked.length, 200);
    strict_1.default.equal(picked[0]?.id, 'c-519');
});
