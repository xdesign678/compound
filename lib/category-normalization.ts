import type { CategoryTag } from './types';

const PRIMARY_CATEGORY_RULES = [
  {
    canonical: '脑科学',
    aliases: ['神经科学', '脑科学/神经科学', '神经系统科学'],
  },
  {
    canonical: '用户体验',
    aliases: ['UX', 'UX设计', '体验设计', '用户体验设计'],
  },
  {
    canonical: '认知心理学',
    aliases: ['决策心理学'],
  },
  {
    canonical: '排版设计',
    aliases: ['版式设计', '字体设计', '视觉排版'],
  },
  {
    canonical: '人工智能',
    aliases: ['AI', '机器学习', '大模型'],
  },
  {
    canonical: '知识管理',
    aliases: ['个人知识管理', 'PKM'],
  },
  {
    canonical: '软件工程',
    aliases: ['编程', '软件架构'],
  },
] as const;

const PRIMARY_ALIAS_MAP = new Map<string, string>();
const STANDALONE_PRIMARY_ROUTES = new Map<string, CategoryTag>([
  ['设计原则', { primary: '用户体验', secondary: '设计原则' }],
]);
const SECONDARY_ROUTES = new Map<string, CategoryTag>([
  ['用户体验', { primary: '用户体验' }],
  ['用户研究', { primary: '用户体验', secondary: '用户研究' }],
  ['人机交互', { primary: '用户体验', secondary: '人机交互' }],
  ['交互设计', { primary: '用户体验', secondary: '人机交互' }],
  ['情感设计', { primary: '用户体验', secondary: '情感设计' }],
  ['行为设计', { primary: '用户体验', secondary: '行为设计' }],
  ['设计系统', { primary: '用户体验', secondary: '设计系统' }],
  ['设计框架', { primary: '用户体验', secondary: '设计框架' }],
  ['设计原则', { primary: '用户体验', secondary: '设计原则' }],
  ['设计困境', { primary: '用户体验', secondary: '设计困境' }],
  ['设计策略', { primary: '用户体验', secondary: '设计策略' }],
  ['设计方法论', { primary: '用户体验', secondary: '设计方法' }],
  ['产品方法论', { primary: '用户体验', secondary: '产品方法' }],
  ['产品理念', { primary: '用户体验', secondary: '产品理念' }],
  ['产品战略', { primary: '用户体验', secondary: '产品策略' }],
  ['协作效率', { primary: '用户体验', secondary: '协作效率' }],
  ['组织管理', { primary: '用户体验', secondary: '组织管理' }],
  ['眼动追踪研究', { primary: '用户体验', secondary: '眼动追踪' }],
  ['认知心理学', { primary: '认知心理学' }],
  ['认知偏差', { primary: '认知心理学', secondary: '认知偏差' }],
  ['决策原则', { primary: '认知心理学', secondary: '决策' }],
  ['决策技术', { primary: '认知心理学', secondary: '决策' }],
  ['认知框架', { primary: '认知心理学', secondary: '认知框架' }],
  ['行为经济学', { primary: '认知心理学', secondary: '行为经济学' }],
  ['动机心理学', { primary: '认知心理学', secondary: '动机心理学' }],
  ['学习方法', { primary: '认知心理学', secondary: '学习方法' }],
  ['注意力机制', { primary: '脑科学', secondary: '注意力机制' }],
  ['笔记软件', { primary: '工具', secondary: '笔记软件' }],
  ['排版设计', { primary: '排版设计' }],
  ['数据可视化', { primary: '排版设计', secondary: '数据可视化' }],
]);
const PATH_PRIMARY_ROUTES = new Map<string, CategoryTag>([
  ['脑科学', { primary: '脑科学' }],
  ['神经科学', { primary: '脑科学' }],
  ['认知科学', { primary: '脑科学', secondary: '认知科学' }],
  ['认知心理学', { primary: '认知心理学' }],
  ['用户体验', { primary: '用户体验' }],
  ['工具', { primary: '工具' }],
  ['排版设计', { primary: '排版设计' }],
]);

for (const rule of PRIMARY_CATEGORY_RULES) {
  PRIMARY_ALIAS_MAP.set(rule.canonical, rule.canonical);
  for (const alias of rule.aliases) {
    PRIMARY_ALIAS_MAP.set(alias, rule.canonical);
  }
}

function cleanSegment(value: string | undefined): string {
  return (value ?? '')
    .replace(/[／∕]/g, '/')
    .replace(/\s*\/\s*/g, '/')
    .trim();
}

function splitPath(value: string | undefined): string[] {
  return cleanSegment(value)
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
}

function canonicalizePrimary(value: string | undefined): string {
  const cleaned = cleanSegment(value);
  return PRIMARY_ALIAS_MAP.get(cleaned) ?? cleaned;
}

function normalizeRoute(route: CategoryTag): CategoryTag {
  const primary = canonicalizePrimary(route.primary);
  const secondary = normalizeSecondary(primary, route.secondary);
  return secondary ? { primary, secondary } : { primary };
}

function routeFromSecondaryPath(parts: string[]): CategoryTag | null {
  if (parts.length === 0) return null;

  const [firstRaw, ...restRaw] = parts;
  const first = canonicalizePrimary(firstRaw);

  if (first === '方法论') {
    return routeFromSecondaryPath(restRaw);
  }

  const exact = SECONDARY_ROUTES.get(first);
  if (exact && restRaw.length === 0) {
    return normalizeRoute(exact);
  }

  const routedPrimary = PATH_PRIMARY_ROUTES.get(first);
  if (routedPrimary) {
    const secondary = restRaw.join('/') || routedPrimary.secondary;
    return normalizeRoute({ primary: routedPrimary.primary, secondary });
  }

  if (exact) {
    const secondary = restRaw.join('/') || exact.secondary;
    return normalizeRoute({ primary: exact.primary, secondary });
  }

  return null;
}

function normalizeSecondary(primary: string, secondary: string | undefined): string | undefined {
  const parts = splitPath(secondary);
  if (parts.length === 0) return undefined;

  if (parts.length > 1 && parts[0] === '方法论') {
    parts.shift();
  }

  if (primary === '脑科学' && parts.length > 1 && parts[0] === '认知科学') {
    parts.shift();
  }

  if (canonicalizePrimary(parts[0]) === primary) {
    parts.shift();
  }

  if (parts.length === 0) return undefined;

  const candidate = parts.join('/');
  if (canonicalizePrimary(candidate) === primary) {
    return undefined;
  }

  return candidate;
}

function normalizeCategoryTag(tag: CategoryTag): CategoryTag | null {
  const primaryParts = splitPath(tag.primary);
  const secondaryParts = splitPath(tag.secondary);

  let primary = canonicalizePrimary(primaryParts[0] ?? secondaryParts[0] ?? '');
  if (!primary) return null;

  const pathParts = secondaryParts.length > 0 ? secondaryParts : primaryParts.slice(1);
  const routedByPath = routeFromSecondaryPath(pathParts);
  if (routedByPath) {
    return routedByPath;
  }

  if (pathParts.length === 0) {
    const standaloneRoute = STANDALONE_PRIMARY_ROUTES.get(primary);
    if (standaloneRoute) {
      return normalizeRoute(standaloneRoute);
    }
  }

  let secondary = pathParts.join('/') || undefined;
  secondary = normalizeSecondary(primary, secondary);

  return secondary ? { primary, secondary } : { primary };
}

export function normalizeCategories(categories: CategoryTag[]): CategoryTag[] {
  const deduped = new Map<string, CategoryTag>();

  for (const tag of categories) {
    const normalized = normalizeCategoryTag(tag);
    if (!normalized) continue;
    const key = normalized.secondary
      ? `${normalized.primary}/${normalized.secondary}`
      : normalized.primary;
    deduped.set(key, normalized);
  }

  const values = Array.from(deduped.values());
  const primariesWithSecondary = new Set(
    values.filter((tag) => tag.secondary).map((tag) => tag.primary),
  );
  const withoutParentDuplicates = values.filter(
    (tag) => tag.secondary || !primariesWithSecondary.has(tag.primary),
  );

  if (withoutParentDuplicates.length <= 1) return withoutParentDuplicates;
  return withoutParentDuplicates.filter((tag) => tag.primary !== '方法论' || tag.secondary);
}

export function normalizeCategoryKeys(categoryKeys: string[]): string[] {
  return toNormalizedCategoryKeys(
    normalizeCategories(
      categoryKeys.map((key) => {
        const parts = splitPath(key);
        return {
          primary: parts[0] ?? '',
          secondary: parts.length > 1 ? parts.slice(1).join('/') : undefined,
        };
      }),
    ),
  );
}

export function normalizeCategoryState(input: {
  categories?: CategoryTag[];
  categoryKeys?: string[];
}): { categories: CategoryTag[]; categoryKeys: string[] } {
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

export function toNormalizedCategoryKeys(categories: CategoryTag[]): string[] {
  const keys = new Set<string>();
  for (const cat of normalizeCategories(categories)) {
    keys.add(cat.primary);
    if (cat.secondary) {
      keys.add(`${cat.primary}/${cat.secondary}`);
    }
  }
  return Array.from(keys);
}
