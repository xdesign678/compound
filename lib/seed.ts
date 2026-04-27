import type { Source, Concept, ActivityLog } from './types';

const DAY = 86400000;
const HOUR = 3600000;
const now = Date.now();

export const SEED_SOURCES: Source[] = [
  {
    id: 's-seed-1',
    title: 'LLM Wiki — an idea file',
    type: 'gist',
    author: 'Andrej Karpathy',
    url: 'https://gist.github.com/karpathy/llm-wiki',
    rawContent: `LLM Wiki is a proposal for a persistent, LLM-maintained knowledge system that replaces RAG. The core insight: instead of having the LLM re-discover knowledge on every query via retrieval, pre-compile all source material into a linked Markdown wiki that the LLM continuously maintains.

Three layers:
1. Raw Sources — immutable originals, human-curated intake
2. Wiki — LLM-compiled, cross-linked Markdown surfaces
3. Schema — config that defines structure, naming, workflows

Three verbs: Ingest, Query, Lint.

The deepest insight: the most exhausting part of maintaining knowledge is not reading or thinking — it's bookkeeping. Humans hate maintaining cross-references. LLMs are exactly the opposite: they read slowly but update ten files in parallel without complaint. When bookkeeping cost goes to zero, personal knowledge systems become viable for the first time.

Wiki has dual identity: human-browsable interface AND pre-synthesized knowledge layer for AI. Same artifact, two audiences.`,
    ingestedAt: now - 2 * DAY,
  },
  {
    id: 's-seed-2',
    title: 'Context Engineering: From Prompts to Context',
    type: 'article',
    author: 'latent.space',
    url: 'https://latent.space/context-engineering',
    rawContent: `Prompt engineering is dead. Long live context engineering.

The shift is subtle but profound: stop optimizing how you phrase requests to LLMs, start optimizing the structured context you feed them. An LLM given a well-engineered context performs an order of magnitude better than the same LLM with clever prompting over raw data.

Context engineering treats the LLM's context window as a designed artifact — like a database schema or API contract. What goes in, in what order, in what format, with what metadata.

LLM Wiki (Karpathy's proposal) is the most complete instance of context engineering: the wiki IS the designed context, maintained continuously. You don't prompt over documents; you prompt over pre-synthesized knowledge.`,
    ingestedAt: now - 3 * DAY,
  },
  {
    id: 's-seed-3',
    title: 'As We May Think (Memex)',
    type: 'article',
    author: 'Vannevar Bush · 1945',
    url: 'https://theatlantic.com/as-we-may-think',
    rawContent: `Consider a future device for individual use, which is a sort of mechanized private file and library. It needs a name, and to coin one at random, "memex" will do.

A memex is a device in which an individual stores all his books, records, and communications, and which is mechanized so that it may be consulted with exceeding speed and flexibility. It is an enlarged intimate supplement to his memory.

The essence of the memex is associative trails — not alphabetical or categorical ordering, but paths of thought that the user builds while reading. Any item can be linked to any other, and such trails are the permanent record of the user's intellectual journey.`,
    ingestedAt: now - 5 * DAY,
  },
  {
    id: 's-seed-4',
    title: 'Why RAG is Not the Final Answer',
    type: 'article',
    author: 'swyx',
    url: 'https://swyx.io/rag-limits',
    rawContent: `RAG works. RAG scales. RAG is easy to set up. But RAG has a structural flaw that becomes obvious once you see it: the system never accumulates knowledge about you or your domain. Each query is an independent event — retrieve chunks, synthesize an answer, forget everything.

This is fine for stateless lookup but fails for any use case involving synthesis across documents, gradual understanding of a field, or building expertise. No amount of retrieval tricks fixes this — it's built into the pattern. The output of RAG is "an answer." The output of a proper system should be "an updated knowledge base."

This is why Karpathy's LLM Wiki feels different: the output of each ingest is a better wiki, not just a better answer. Use compounds. RAG doesn't.`,
    ingestedAt: now - 7 * DAY,
  },
  {
    id: 's-seed-5',
    title: 'Zettelkasten for the Age of AI',
    type: 'pdf',
    author: 'J. Chen',
    url: 'zettelkasten-ai.pdf',
    rawContent: `Niklas Luhmann's Zettelkasten produced 70 books from 90,000 handwritten cards. Atomic notes, dense bidirectional links, emergent structure. The method works — Luhmann proved it. But almost everyone who adopts Zettelkasten quits within 6 months.

The reason is not laziness or discipline. It's that cross-reference maintenance is anti-human. Writing card #5,000 and checking whether it should link to cards #237, #891, and #3,412 is cognitively miserable. Humans evolved for narrative, not graph maintenance.

LLMs are the inverse: mediocre at originality, superb at parallel bookkeeping. An "AI-executed Zettelkasten" — humans write atomic thoughts, LLMs maintain the link graph — may be the first version of the method that actually works at scale for normal users.`,
    ingestedAt: now - 10 * DAY,
  },
];

export const SEED_CONCEPTS: Concept[] = [
  {
    id: 'c-seed-1',
    title: 'LLM Wiki 模式',
    summary:
      '由 LLM 维护的持久化 Markdown Wiki,替代每次从零检索的 RAG。核心是把知识预先综合而不是临时拼接。',
    body: `**LLM Wiki** 是 Andrej Karpathy 2026 年 4 月提出的知识系统范式。它的核心主张是:与其让 LLM 在每次提问时临时检索原始文本块([RAG 的做法](concept:c-seed-2)),不如让 LLM 提前把所有资料综合进一个相互链接的 Markdown Wiki。

这个 Wiki 由 LLM 持续维护——每当有新资料进入,它会读完并在十几个相关页面上同时更新交叉引用。这恰好是[人类在维护知识库时最痛苦的 bookkeeping 部分](concept:c-seed-5)。

Wiki 有双重身份:**对人类是可浏览的知识界面,对 AI 是预先综合的知识层**——同一个产物,两种受众。`,
    sources: ['s-seed-1', 's-seed-4'],
    related: ['c-seed-2', 'c-seed-3', 'c-seed-4', 'c-seed-5'],
    createdAt: now - 2 * DAY,
    updatedAt: now - 1 * HOUR,
    version: 3,
    categories: [{ primary: '人工智能', secondary: '知识系统' }],
    categoryKeys: ['人工智能', '人工智能/知识系统'],
  },
  {
    id: 'c-seed-2',
    title: 'RAG 的结构性缺陷',
    summary:
      '"LLM 在每次提问时都是从零重新发现知识,没有任何积累。" 检索即用即弃,跨文档综合能力缺失。',
    body: `RAG 被广泛采用,但 Karpathy 指出它有一个容易被忽视的结构性缺陷:**没有积累**。每次查询都是独立事件——检索几个文本块,拼接回答,然后遗忘。

这意味着无论你用系统多少次,它对你的领域从未变得更懂一点。所有跨文档的综合、概念间的张力、隐含的矛盾,都要在每次查询时从零重新发现。

相比之下,[LLM Wiki](concept:c-seed-1) 把综合工作前置,用预编译换查询时的临场拼接。`,
    sources: ['s-seed-1', 's-seed-4'],
    related: ['c-seed-1', 'c-seed-6'],
    createdAt: now - 2 * DAY,
    updatedAt: now - 1 * HOUR,
    version: 2,
    categories: [{ primary: '人工智能', secondary: '知识系统' }],
    categoryKeys: ['人工智能', '人工智能/知识系统'],
  },
  {
    id: 'c-seed-3',
    title: '三层架构',
    summary: 'Raw Sources(原始资料)+ Wiki(LLM 维护的知识层)+ Schema(治理规范)。三层分离,角色清晰。',
    body: `LLM Wiki 的系统结构只有三层:

**第一层 Raw Sources**:不可变的原始资料。LLM 只读不改。人类负责策划——决定什么该进。

**第二层 Wiki**:LLM 编译并持续维护的 Markdown 集合,含摘要页、概念页、交叉引用。

**第三层 Schema**:配置文件,定义 Wiki 的结构规范、命名约定、工作流。类似给知识库专用的 CLAUDE.md。`,
    sources: ['s-seed-1'],
    related: ['c-seed-1', 'c-seed-4'],
    createdAt: now - 2 * DAY,
    updatedAt: now - 2 * HOUR,
    version: 1,
    categories: [
      { primary: '人工智能', secondary: '知识系统' },
      { primary: '软件架构', secondary: '系统设计' },
    ],
    categoryKeys: ['人工智能', '人工智能/知识系统', '软件架构', '软件架构/系统设计'],
  },
  {
    id: 'c-seed-4',
    title: 'Ingest · Query · Lint',
    summary: '系统的三个核心动作。摄入新资料,查询已编译知识,定期体检修复矛盾和孤立页。',
    body: `所有操作归结为三个动词:

**Ingest**:摄入新资料。单次处理通常同步更新 10–15 个相关页面,并在 log 记一笔。

**Query**:查询走已综合的 Wiki,不走原始文档。有价值的回答自动归档为新页面——这是[知识复利](concept:c-seed-6)的入口。

**Lint**:定期体检,找矛盾声明、孤立页面、缺失链接。LLM 最擅长、人类最讨厌的工作。`,
    sources: ['s-seed-1'],
    related: ['c-seed-1', 'c-seed-3'],
    createdAt: now - 2 * DAY,
    updatedAt: now - 2 * HOUR,
    version: 1,
    categories: [{ primary: '人工智能', secondary: '知识系统' }],
    categoryKeys: ['人工智能', '人工智能/知识系统'],
  },
  {
    id: 'c-seed-5',
    title: 'Bookkeeping 洞察',
    summary:
      '"维护知识库中最累的不是阅读或思考——而是记账整理。" LLM 正好反过来:读不快想不深,但并行维护不累。',
    body: `这是整个范式的真正命门。历史上 [Memex](concept:c-seed-7)、Zettelkasten、个人 Wiki 这些想法全都存在,但几乎所有人都半途而废——不是懒得读,是**维护交叉引用对人类来说反人性**。

LLM 恰好反过来。读不快、想不深,但同时更新十个文件不喊累。当 bookkeeping 的成本趋近于零,个人知识系统才第一次真正可行。`,
    sources: ['s-seed-1', 's-seed-5'],
    related: ['c-seed-1', 'c-seed-7'],
    createdAt: now - 2 * DAY,
    updatedAt: now - 3 * HOUR,
    version: 1,
    categories: [
      { primary: '人工智能', secondary: '知识系统' },
      { primary: '认知科学', secondary: '认知负荷' },
    ],
    categoryKeys: ['人工智能', '人工智能/知识系统', '认知科学', '认知科学/认知负荷'],
  },
  {
    id: 'c-seed-6',
    title: '知识复利',
    summary: '每次查询不仅消费知识,也生产知识(归档为新页面)。系统随时间变得更懂你的领域。',
    body: `RAG 系统不会随使用变聪明。LLM Wiki 系统会。

机制很简单:每个有价值的 Query 回答都可以被归档为新的 Wiki 页面。Wiki 既是回答的来源,又是回答的产物。这形成了一个正反馈:**用得越多,Wiki 越丰富,回答越好**。

这是 RAG 范式原理上做不到的——因为 RAG 的产物是"回答本身",不是"知识库的更新"。`,
    sources: ['s-seed-1', 's-seed-4'],
    related: ['c-seed-1', 'c-seed-2'],
    createdAt: now - 2 * DAY,
    updatedAt: now - 1 * DAY,
    version: 1,
    categories: [{ primary: '人工智能', secondary: '知识系统' }],
    categoryKeys: ['人工智能', '人工智能/知识系统'],
  },
  {
    id: 'c-seed-7',
    title: 'Memex · Vannevar Bush',
    summary: '1945 年 Bush 在《As We May Think》中提出的个人知识关联机器。LLM Wiki 的精神祖先。',
    body: `Vannevar Bush 在 1945 年《As We May Think》中描述了一种名为 Memex 的个人机器:它让研究者能够在阅读时为文档建立"关联路径"——不是按字母顺序,而是按思维顺序。

Memex 80 年来未被真正兑现的原因是[关联维护成本太高](concept:c-seed-5)。LLM Wiki 被 Karpathy 视为这个想法的当代兑现。`,
    sources: ['s-seed-3'],
    related: ['c-seed-1', 'c-seed-5'],
    createdAt: now - 5 * DAY,
    updatedAt: now - 1 * DAY,
    version: 1,
    categories: [{ primary: '知识管理', secondary: '历史' }],
    categoryKeys: ['知识管理', '知识管理/历史'],
  },
  {
    id: 'c-seed-8',
    title: 'Context Engineering',
    summary:
      '从 prompt engineering 演进到的新学科:工程化地构建高质量上下文,而不是琢磨 prompt 措辞。',
    body: `Karpathy 长期倡导从 prompt engineering 演进到 **context engineering**——重点不是 prompt 怎么措辞,而是**工程化地构建 LLM 看到的上下文**。

[LLM Wiki](concept:c-seed-1) 是 context engineering 的最完整具象:你不是让 AI 每次面对原始文本,而是为 AI 准备一个结构化、可维护、持续演化的知识操作系统。`,
    sources: ['s-seed-2'],
    related: ['c-seed-1'],
    createdAt: now - 3 * DAY,
    updatedAt: now - 1 * DAY,
    version: 1,
    categories: [{ primary: '人工智能', secondary: 'Prompt 工程' }],
    categoryKeys: ['人工智能', '人工智能/Prompt 工程'],
  },
  {
    id: 'c-seed-9',
    title: 'Zettelkasten 的 AI 兑现',
    summary:
      'Luhmann 的卡片笔记法。原子化笔记 + 密集链接。与 LLM Wiki 同构,但需要人类执行,因此大多数人失败。',
    body: `Zettelkasten 由德国社会学家 Luhmann 发明,他用 90,000 张卡片支撑了 70 本书的产出。核心是**原子化笔记 + 密集双向链接**。

它的问题和 [Memex](concept:c-seed-7) 类似:维护成本太高。大多数人买了漂亮的卡片盒,写了 50 张卡,然后放弃。

LLM Wiki 可以看作**"由 AI 执行的 Zettelkasten"**——人类负责想和策划,AI 负责链接和维护。`,
    sources: ['s-seed-5'],
    related: ['c-seed-5', 'c-seed-7'],
    createdAt: now - 10 * DAY,
    updatedAt: now - 3 * DAY,
    version: 1,
    categories: [{ primary: '知识管理', secondary: '笔记方法论' }],
    categoryKeys: ['知识管理', '知识管理/笔记方法论'],
  },
];

export const SEED_ACTIVITY: ActivityLog[] = [
  {
    id: 'a-seed-1',
    type: 'ingest',
    title: '摄入 <em>LLM Wiki — an idea file</em>',
    details: '新建 5 个概念页,更新 7 个现有页,建立 18 条交叉引用',
    relatedSourceIds: ['s-seed-1'],
    at: now - 1 * HOUR,
  },
  {
    id: 'a-seed-2',
    type: 'lint',
    title: '健康检查完成',
    details: '发现 2 处矛盾声明,自动标记;补齐 4 条缺失链接',
    at: now - 2 * HOUR,
  },
  {
    id: 'a-seed-3',
    type: 'query',
    title: '归档 <em>"Karpathy 为何反对 RAG"</em>',
    details: '答案被保存为「RAG 的结构性缺陷」概念页',
    relatedConceptIds: ['c-seed-2'],
    at: now - 3 * HOUR,
  },
  {
    id: 'a-seed-4',
    type: 'ingest',
    title: '摄入 <em>Context Engineering</em>',
    details: '新建 1 个概念页,更新 3 个,建立 11 条交叉引用',
    relatedSourceIds: ['s-seed-2'],
    at: now - 1 * DAY,
  },
  {
    id: 'a-seed-5',
    type: 'ingest',
    title: '摄入 <em>As We May Think</em>',
    details: '新建 1 个概念页(Memex),建立 5 条交叉引用',
    relatedSourceIds: ['s-seed-3'],
    at: now - 5 * DAY,
  },
];
