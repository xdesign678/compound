import type { LucideIcon } from 'lucide-react';
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

export const DEFAULT_PRIMARY_CATEGORY_ICON: LucideIcon = Grid2x2;

const PRIMARY_CATEGORY_ICON_MAP: Record<string, LucideIcon> = {
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

const PRIMARY_CATEGORY_ICON_RULES: Array<{ match: RegExp; icon: LucideIcon }> = [
  { match: /AI|人工智能|机器学习|大模型|神经网络/i, icon: Bot },
  { match: /软件|编程|开发|代码|工程/, icon: Code2 },
  { match: /神经|脑/, icon: BrainCircuit },
  { match: /认知|意识|心理/, icon: Brain },
  { match: /进化|基因|生物/, icon: Dna },
  { match: /体验|交互|可用性/, icon: MousePointer2 },
  { match: /中国|东方|国学/, icon: Landmark },
  { match: /存在|现象学|本体/, icon: Drama },
  { match: /哲学|形而上/, icon: InfinityIcon },
  { match: /方法|流程|框架/, icon: Workflow },
  { match: /观念|思想|理论/, icon: Scroll },
  { match: /知识|笔记|学习/, icon: Library },
  { match: /排版|字体|视觉/, icon: Type },
  { match: /叙事|故事|剧本|戏剧/, icon: Film },
  { match: /传播|媒介|媒体/, icon: Megaphone },
  { match: /文学|文化|语言/, icon: BookOpen },
  { match: /历史|文明|传记/, icon: History },
  { match: /行为经济|数据|统计|信息/, icon: BarChart3 },
  { match: /经济/, icon: LineChart },
  { match: /金融|资本|货币|投资/, icon: Banknote },
  { match: /商业模式|战略|策略/, icon: Layers },
  { match: /商业|管理|组织|企业|经营/, icon: Briefcase },
  { match: /物理|化学|数学|科学/, icon: Atom },
  { match: /设计|美学|艺术/, icon: Palette },
  { match: /工具|效率|工作流/, icon: Wrench },
];

export function getPrimaryCategoryIcon(primary: string | null | undefined): LucideIcon {
  if (!primary) return DEFAULT_PRIMARY_CATEGORY_ICON;
  const exact = PRIMARY_CATEGORY_ICON_MAP[primary];
  if (exact) return exact;
  return (
    PRIMARY_CATEGORY_ICON_RULES.find((rule) => rule.match.test(primary))?.icon ??
    DEFAULT_PRIMARY_CATEGORY_ICON
  );
}
