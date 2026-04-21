"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const category_normalization_1 = require("./category-normalization");
(0, node_test_1.default)('strictly merges neuroscience aliases into 脑科学', () => {
    const normalized = (0, category_normalization_1.normalizeCategories)([
        { primary: '神经科学' },
        { primary: '脑科学/神经科学' },
        { primary: '脑科学', secondary: '神经科学' },
    ]);
    strict_1.default.deepEqual(normalized, [{ primary: '脑科学' }]);
});
(0, node_test_1.default)('keeps meaningful secondary labels while removing duplicates and blanks', () => {
    const normalized = (0, category_normalization_1.normalizeCategories)([
        { primary: '脑科学', secondary: '睡眠与节律' },
        { primary: '脑科学', secondary: '睡眠与节律' },
        { primary: '  脑科学  ', secondary: '  ' },
        { primary: '', secondary: '神经科学' },
    ]);
    strict_1.default.deepEqual(normalized, [
        { primary: '脑科学', secondary: '睡眠与节律' },
        { primary: '脑科学' },
    ]);
});
(0, node_test_1.default)('normalizes flat category keys before prompt reuse and filtering', () => {
    const normalized = (0, category_normalization_1.normalizeCategoryKeys)([
        '神经科学',
        '脑科学/神经科学',
        '脑科学',
        '脑科学/睡眠与节律',
    ]);
    strict_1.default.deepEqual(normalized, ['脑科学', '脑科学/睡眠与节律']);
});
