"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toCategoryKeys = toCategoryKeys;
const category_normalization_1 = require("./category-normalization");
/** Derive flat categoryKeys from structured categories for Dexie MultiEntry index. */
function toCategoryKeys(categories) {
    return (0, category_normalization_1.toNormalizedCategoryKeys)(categories);
}
