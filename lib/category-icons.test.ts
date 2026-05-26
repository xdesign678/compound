import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Atom,
  Banknote,
  BarChart3,
  BookOpen,
  Bot,
  Brain,
  BrainCircuit,
  Briefcase,
  Code2,
  Dna,
  Drama,
  Film,
  Grid2x2,
  History,
  Infinity as InfinityIcon,
  Landmark,
  Layers,
  Library,
  LineChart,
  Megaphone,
  MousePointer2,
  Palette,
  Scroll,
  Type,
  Workflow,
  Wrench,
} from 'lucide-react';

import { DEFAULT_PRIMARY_CATEGORY_ICON, getPrimaryCategoryIcon } from './category-icons';

test('exact map covers every visible primary category with a unique icon', () => {
  const expected: Record<string, unknown> = {
    全部: Grid2x2,
    认知心理学: Brain,
    用户体验: MousePointer2,
    哲学: InfinityIcon,
    方法论: Workflow,
    脑科学: BrainCircuit,
    进化心理学: Dna,
    观念史: Scroll,
    知识管理: Library,
    排版设计: Type,
    商业: Briefcase,
    文学: BookOpen,
    工具: Wrench,
    经济学: LineChart,
    金融: Banknote,
    物理科学: Atom,
    人工智能: Bot,
    行为经济学: BarChart3,
    存在主义: Drama,
    中国哲学: Landmark,
    文化传播: Megaphone,
    叙事设计: Film,
    软件工程: Code2,
    商业模式: Layers,
    历史: History,
  };

  for (const [primary, icon] of Object.entries(expected)) {
    assert.equal(
      getPrimaryCategoryIcon(primary),
      icon,
      `${primary} should map to its dedicated icon`,
    );
  }

  const iconValues = Object.values(expected);
  assert.equal(
    new Set(iconValues).size,
    iconValues.length,
    'visible categories must not share icons',
  );
});

test('falls back to regex rules for unmapped primaries', () => {
  assert.equal(getPrimaryCategoryIcon('社会心理学'), Brain);
  assert.equal(getPrimaryCategoryIcon('神经美学'), BrainCircuit);
  assert.equal(getPrimaryCategoryIcon('AI伦理'), Bot);
  assert.equal(getPrimaryCategoryIcon('机器学习理论'), Bot);
  assert.equal(getPrimaryCategoryIcon('交互设计'), MousePointer2);
  assert.equal(getPrimaryCategoryIcon('开发流程'), Code2);
  assert.equal(getPrimaryCategoryIcon('视觉传达'), Type);
  assert.equal(getPrimaryCategoryIcon('投资学'), Banknote);
  assert.equal(getPrimaryCategoryIcon('微观经济'), LineChart);
  assert.equal(getPrimaryCategoryIcon('信息论'), BarChart3);
  assert.equal(getPrimaryCategoryIcon('管理学'), Briefcase);
  assert.equal(getPrimaryCategoryIcon('美学'), Palette);
  assert.equal(getPrimaryCategoryIcon('数学'), Atom);
});

test('returns default icon for null, undefined, or unknown values', () => {
  assert.equal(getPrimaryCategoryIcon(null), DEFAULT_PRIMARY_CATEGORY_ICON);
  assert.equal(getPrimaryCategoryIcon(undefined), DEFAULT_PRIMARY_CATEGORY_ICON);
  assert.equal(getPrimaryCategoryIcon(''), DEFAULT_PRIMARY_CATEGORY_ICON);
  assert.equal(getPrimaryCategoryIcon('🤷 完全未知词'), DEFAULT_PRIMARY_CATEGORY_ICON);
  assert.equal(DEFAULT_PRIMARY_CATEGORY_ICON, Grid2x2);
});
