"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeCategories = normalizeCategories;
exports.normalizeCategoryKeys = normalizeCategoryKeys;
exports.normalizeCategoryState = normalizeCategoryState;
exports.toNormalizedCategoryKeys = toNormalizedCategoryKeys;
const PRIMARY_CATEGORY_RULES = [
    {
        canonical: '脑科学',
        aliases: ['神经科学', '脑科学/神经科学', '神经系统科学'],
    },
];
const PRIMARY_ALIAS_MAP = new Map();
for (const rule of PRIMARY_CATEGORY_RULES) {
    PRIMARY_ALIAS_MAP.set(rule.canonical, rule.canonical);
    for (const alias of rule.aliases) {
        PRIMARY_ALIAS_MAP.set(alias, rule.canonical);
    }
}
function cleanSegment(value) {
    return (value ?? '')
        .replace(/[／∕]/g, '/')
        .replace(/\s*\/\s*/g, '/')
        .trim();
}
function splitPath(value) {
    return cleanSegment(value)
        .split('/')
        .map((part) => part.trim())
        .filter(Boolean);
}
function canonicalizePrimary(value) {
    const cleaned = cleanSegment(value);
    return PRIMARY_ALIAS_MAP.get(cleaned) ?? cleaned;
}
function normalizeSecondary(primary, secondary) {
    const parts = splitPath(secondary);
    if (parts.length === 0)
        return undefined;
    if (canonicalizePrimary(parts[0]) === primary) {
        parts.shift();
    }
    if (parts.length === 0)
        return undefined;
    const candidate = parts.join('/');
    if (canonicalizePrimary(candidate) === primary) {
        return undefined;
    }
    return candidate;
}
function normalizeCategoryTag(tag) {
    const primaryParts = splitPath(tag.primary);
    const secondaryParts = splitPath(tag.secondary);
    let primary = canonicalizePrimary(primaryParts[0] ?? secondaryParts[0] ?? '');
    if (!primary)
        return null;
    let secondary = secondaryParts.join('/') || undefined;
    if (!secondary && primaryParts.length > 1) {
        secondary = primaryParts.slice(1).join('/');
    }
    secondary = normalizeSecondary(primary, secondary);
    return secondary ? { primary, secondary } : { primary };
}
function normalizeCategories(categories) {
    const deduped = new Map();
    for (const tag of categories) {
        const normalized = normalizeCategoryTag(tag);
        if (!normalized)
            continue;
        const key = normalized.secondary
            ? `${normalized.primary}/${normalized.secondary}`
            : normalized.primary;
        deduped.set(key, normalized);
    }
    return Array.from(deduped.values());
}
function normalizeCategoryKeys(categoryKeys) {
    return toNormalizedCategoryKeys(normalizeCategories(categoryKeys.map((key) => {
        const parts = splitPath(key);
        return {
            primary: parts[0] ?? '',
            secondary: parts.length > 1 ? parts.slice(1).join('/') : undefined,
        };
    })));
}
function normalizeCategoryState(input) {
    const merged = [
        ...(input.categories ?? []),
        ...(input.categoryKeys ?? []).map((key) => {
            const parts = splitPath(key);
            return {
                primary: parts[0] ?? '',
                secondary: parts.length > 1 ? parts.slice(1).join('/') : undefined,
            };
        }),
    ];
    const categories = normalizeCategories(merged);
    return {
        categories,
        categoryKeys: toNormalizedCategoryKeys(categories),
    };
}
function toNormalizedCategoryKeys(categories) {
    const keys = new Set();
    for (const cat of normalizeCategories(categories)) {
        keys.add(cat.primary);
        if (cat.secondary) {
            keys.add(`${cat.primary}/${cat.secondary}`);
        }
    }
    return Array.from(keys);
}
