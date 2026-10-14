# 三视图合一 + 关系矩阵优化方案

> **本文档为权威副本**：`wenyuan-v3/docs/三视图合一-UI方案.md`（v3 项目内）。
> 初稿来源：`~/.workbuddy-ai/plans/stellar-nebula-newton-vcnLOU_J.md`（计划模式产物）；
> 会话侧另有一份同内容拷贝 `WorkBuddy AI/2026-09-30-17-25-08/ui-demos/PLAN-三视图合一.md`（供 demo 目录就近参考）。
> ⚠️ **今后只维护本文件**（v3 项目内这份）；其余两份为初稿/拷贝，不再更新。

**目标**：把 A（力导向全图）/ B（聚焦视图）/ C（关系矩阵与演化）三个演示，合成一个应用；并修好矩阵「看不到对应角色」的问题。

**约束**：严格保持 v1 主题与样式（四主题 × 69 令牌、v1 真实组件类名）；$0、无构建步骤、无框架、无 npm 依赖；不改动已验收的 A/B/C 三个文件。

**状态**：方案已定稿，待实施。

---

## 一、已核实的数据事实（独立实跑，可直接依赖）

`window.WY_DATA` 顶层键：`book, nodes, edges, dupGroups, exclusiveHits, evidence, chapters, codes, sizes, honglou`

| 事实 | 值 | 陷阱 |
|---|---|---|
| `nodes` | 46 项 | ⚠️ **`degree` 是全库度数**（全库 873 实体），必须按 `edges` 实算 `SUB_DEG` |
| 子图 0 度节点 | **仅 `陈木南`**（全库 degree=7） | 需走空态，不是 bug |
| `edges` | 116 项 | **`source`/`target` 是 UUID 字符串**，不是索引 |
| `start` | **116 条全非空**，范围 2~54 | |
| `end` | **82 条 null**（持续至今），34 条非空 | |
| `status` | `ACTIVE` 107 / `ENDED` 9 | |
| `ev` | **数字** 1~4 | ⚠️ **不是数组**，不能 `.length` |
| `evidence` | **对象**，93 键（键=`edge.id`），值=字符串数组 | ⚠️ **不是数组**；116 条边中 **93 条有原文 / 23 条无** |
| `chapters` | 57 项，`ordinal` **从 0 起**（0=前言） | ✅ **`chapters[start].title` 正确**，绝不用 `start+1` |
| `codes` | 10 项 | ⚠️ `codes[].n` 是**全库**边数 |
| 子图内码分布 | 朋友92 师生8 同僚6 主仆3 兄弟3 父子3 同年1 = **7 个** | `夫妻`/`母子`/`仇敌` 子图内 **0 条** |
| 子图内 cat 分布 | **只有 0 / 1 / 3**（6 / 99 / 11） | **cat2 空** |
| 共现人物对 | **11 对**（唯一人物对 103） | |
| `exclusiveHits` | 1 项 = **杜少卿 ↔ 杜慎卿**（父子+兄弟） | `pair` 是 **UUID 串**，需查 `nameById` |

**7×7 矩阵（已独立复算，逐格与方案一致 → 作为验收基准）**：

```
        朋友  师生  同僚  主仆  兄弟  父子  同年
朋友     92    4     3     2     2     1     0
师生      4    8     0     0     1     0     0
同僚      3    0     6     0     0     0     1
主仆      2    0     0     3     0     0     0
兄弟      2    1     0     0     3     1     0
父子      1    0     0     0     1     3     0
同年      0    0     1     0     0     0     1
```

- 对角（=该码涉及的人物对数）：朋友 92 · 师生 8 · 同僚 6 · 主仆 3 · 兄弟 3 · 父子 3 · 同年 1
- 非对角最大：**朋友×师生 = 4**
- 关键锚点：**父子×兄弟 = 1**（杜少卿↔杜慎卿）· 主仆×朋友 = 2

**关系类型配色（已从 v1 源 `src/theme/tokens/*/index.ts` 逐字取出，非臆造）**：

| 主题 | 亲属(0) | 友好(1) | 对立(2) | 从属(3) | 其他(4) |
|---|---|---|---|---|---|
| suya | `#B84040` | `#4A7AB0` | `#C08530` | `#3D7A5C` | `#6B5A98` |
| danqing | `#C44A3A` | `#4870B8` | `#C08030` | `#3D8B5C` | `#7B5FA8` |
| diancang | `#C45550` | `#5A8CBB` | `#C9904A` | `#4A9462` | `#8A68BB` |
| xingkong | `#C45858` | `#4A9AC8` | `#C0904A` | `#5AAE7A` | `#8A7ABE` |

> 这 5 色**不在** `_v1-tokens.css` 里（现有文件只有 `--chart-1..5`）。本方案在 `app.html` 的作用域内定义 `--rel-*` 五个变量 × 四主题，**值即上表**（不回落 `--chart-N`，不做 TODO）。

---

## 二、文件决策

**新建 `app.html` 作为主入口；A/B/C 三个文件原样保留。**

| 文件 | 处置 | 理由 |
|---|---|---|
| **`app.html`**（新建） | 单页应用主入口 | 兑现「合成一个应用」 |
| `_app-engine.js`（新建） | 数据索引 + 共享 state + 三视图 render | 抽成独立文件，便于 Node 侧跑校验 |
| `A-力导向全图.html` | **不动** | 已过四层校验；用户此前要过「三个演示 html」 |
| `B-聚焦视图.html` | **不动** | 同上 |
| `C-关系矩阵与演化.html` | **不动** | 同上，保留为「矩阵独立版」对照 |

**兼顾「三个」与「合一」**：三个独立 HTML 继续各自可打开、各自可校验；`app.html` 是它们的超集。**不用 iframe 内嵌**（跨文档共享 state 极痛苦），改为把 A/B/C 的核心渲染逻辑抽进 `_app-engine.js`，三视图共用一份 `state`。

---

## 三、布局与状态机

```
body.app (flex column)
├── header.viewer-header        ← 顶栏：logo + 三视图切换 + theme-toggle
├── header.graph-page-header    ← 书信息条：书名 / 统计 / 当前回
├── main.app-body (flex row, flex:1)
│   ├── section.main-stage (flex:1)     ← 主舞台
│   │   ├── div#stageAll   （力导向 Canvas，默认）
│   │   └── div#stageFocus （聚焦三栏，复用 B 的 .picker/.stage/.profile）
│   └── aside.aux-drawer (右侧可折叠, 宽 0 → 30rem)   ← 矩阵与演化辅助面板
└── div.timeline-bar            ← 底部章节时间轴（全图/聚焦共用）
```

**三视图切换**（放 `.viewer-nav`，复用 `.viewer-header-nav-button`）：

```html
<nav class="viewer-nav">
  <button class="viewer-header-nav-button" data-view="all" data-active="true">力导向全图</button>
  <button class="viewer-header-nav-button" data-view="focus">聚焦视图</button>
  <button class="viewer-header-nav-button" data-view="matrix">矩阵与演化</button>
</nav>
```

**交互流**：
- 默认 `view='all'`（力导向全图）
- **点节点** → `setView('focus', {center:i})`：切聚焦三栏，左栏滚到并高亮该人
- 点「矩阵与演化」→ 右侧抽屉展开，矩阵与演化并排在全图右侧（**不是**换成独立页）→ 这样点矩阵格子时左侧全图能同步高亮，直接回应「看到对应角色」

**为什么选右侧抽屉而非底部折叠**：矩阵是 7×7 带斜置表头，高度约 360px，底部横条会和 `timeline-bar` 抢空间；抽屉能与主图**并排共存**，实现「矩阵↔全图」双向高亮。收起态只需约 2.5rem 宽的竖标签。

**共享 state（唯一实例，挂 `window.__APP_STATE`）**：

```js
var state = {
  view: 'all',                    // 'all' | 'focus' | 'matrix'
  layout: 'force',                // 'force' | 'radial' | 'tree'
  relFilter: {},                  // { code: bool } 关系码过滤
  catFilter: { 0:true, 1:true, 3:true },   // 只留实际存在的类
  statusFilter: { ACTIVE:true, DRAFT:true, REJECTED:true },
  searchQuery: '',
  maxChapter: 56,                 // 时间轴窗口
  center: null,                   // 聚焦中心
  selected: null,                 // 全图选中节点索引
  detail: null,                   // { a, b, isDiag } 当前详情卡
  highlightPairs: null,           // [[i,j],...] 矩阵↔全图联动高亮
  evoWindow: 0,
  seriesOff: {}
};
```

---

## 四、矩阵详情卡（核心）

### 数据装配链

```js
// 初始化一次性建索引
var nameById = {};  nodes.forEach(n => nameById[n.id] = n.name);
var edgeIndex = {}; // "smallIdx|bigIdx" -> [edge,...]
edges.forEach(e => {
  var k = e._s < e._t ? e._s + '|' + e._t : e._t + '|' + e._s;
  (edgeIndex[k] = edgeIndex[k] || []).push(e);
});
var codeMeta = {};  codes.forEach(c => codeMeta[c.code] = c);
var evidence = D.evidence || {};

// 点非对角格
function buildPairDetail(codeA, codeB) {
  return Object.keys(edgeIndex).map(function (k) {
    var list = edgeIndex[k], set = {}; list.forEach(e => set[e.code] = 1);
    if (!(set[codeA] && set[codeB])) return null;
    var ij = k.split('|').map(Number);
    return { i: ij[0], j: ij[1], nameA: nodes[ij[0]].name, nameB: nodes[ij[1]].name, edges: list.slice() };
  }).filter(Boolean);
}

// 点对角格
function buildDiagDetail(code) {
  return Object.keys(edgeIndex).filter(k => edgeIndex[k].some(e => e.code === code))
    .map(function (k) {
      var ij = k.split('|').map(Number);
      return { i: ij[0], j: ij[1], nameA: nodes[ij[0]].name, nameB: nodes[ij[1]].name,
               edges: edgeIndex[k].filter(e => e.code === code) };
    });
}

// 单条边 → 视图模型（含两条查表 + 兜底）
function edgeRow(e) {
  var title = (e.start != null && chapters[e.start])
    ? chapters[e.start].title                      // ✅ chapters[start]，不要 start+1
    : ('第 ' + (e.start != null ? e.start : '?') + ' 回');
  var evList = evidence[e.id];
  var quotes = (evList && evList.length)
    ? evList.map(q => '<p class="qc">「' + q + '」</p>').join('')
    : '<p class="qc muted">无原文片段（证据计数 ev=' + e.ev + '）</p>';   // ← 23 条兜底
  return { sn: nameById[e.source], cn: nameById[e.target], meta: codeMeta[e.code] || {},
           start: e.start, end: e.end, status: e.status, ev: e.ev, chTitle: title, quotes: quotes };
}
```

### 详情卡 DOM（复用 v1 类名，不新增全局 CSS）

```html
<div class="ui-card card-detail">
  <div class="ui-card-header">
    <div class="ui-card-title">
      <span class="gt-chip" data-on="true">父子</span>
      <span class="cd-x">×</span>
      <span class="gt-chip" data-on="true">兄弟</span>
      <span class="ui-badge" data-variant="outline">共同出现 1 组人物对</span>
      <button class="gt-close" aria-label="关闭">✕</button>
    </div>
    <p class="ui-card-description">同时具备「父子」与「兄弟」两种关系的同一对人物。</p>
  </div>
  <div class="ui-card-content">
    <div class="cd-pair">
      <div class="cd-pair-head">
        <span class="gl-swatch" style="background:var(--rel-family)"></span>
        <b>杜少卿</b><span class="cd-arrow">↔</span><b>杜慎卿</b>
        <span class="ui-badge" data-variant="secondary">3 条关系</span>
        <span class="ui-badge" data-variant="destructive">关系特异</span>
      </div>
      <div class="cd-rel-chiprow">
        <span class="tl-rel-chip">父子</span><span class="tl-rel-chip">兄弟</span><span class="tl-rel-chip">朋友</span>
      </div>
      <ul class="cd-edge-list">
        <li class="cd-edge">
          <div class="cd-edge-top">
            <span class="tl-rel-chip">父子</span>
            <span class="muted">第三十一回　…</span>
            <span class="ui-badge" data-variant="success">持续中</span>
            <span class="muted">证据 ×1</span>
          </div>
          <p class="qc">「…原文片段…」</p>
        </li>
        <!-- 其余边 -->
      </ul>
    </div>
  </div>
</div>
```

- **对角格**：标题换成单个 chip，说明改「共 92 组人物对」，**默认只渲染前 20 组 + 「展开全部」**（避免 92 组一次 DOM 爆量）
- **空态**：点 `v=0` 的格子不弹卡（`data-empty`，无响应）；`陈木南` 相关走「该人物在本子图中无关系记录」
- **兜底**：23 条无原文显示「无原文片段（证据计数 ev=N）」灰字 —— 真实样本已验证：**余大先生↔余二先生 的「兄弟」边确实无原文**
- **位置**：**矩阵正下方内联展开**（同一抽屉内）。理由：强绑定「点哪看哪」，视线不跳；抽屉已可滚动；若再套一层浮层，窄屏会爆炸。抽屉收起时点格子 → 自动展开抽屉并滚到卡片。

---

## 五、移除空行列：10×10 → 7×7

**现状问题代码**（`C` 第 271 行，用全库 `codes[].n` 排序后 `slice(0,10)`，把子图内 0 条的 3 个码也带进来了）：

```js
var TOP_CODES = codes.slice().sort((a,b) => b.n - a.n).slice(0,10).map(c => c.code);
```

**改为按子图实算**：

```js
var subCodeCount = {};
edges.forEach(e => subCodeCount[e.code] = (subCodeCount[e.code] || 0) + 1);
// 只留子图内 n>0 的码，按子图次数降序
var TOP_CODES = Object.keys(subCodeCount).sort((a,b) => subCodeCount[b] - subCodeCount[a]);
// → ['朋友','师生','同僚','主仆','兄弟','父子','同年']
```

**大类映射按数据实际**（子图只有 0/1/3）：

```js
var CAT_LABEL = { 0:'亲属', 1:'社交', 3:'主从' };
var CAT_REL_VAR = { 0:'--rel-family', 1:'--rel-friendly', 3:'--rel-subordinate' };
```

> ⚠️ 现有 A/B/C 里的 `CAT_LABEL = {0:'亲属',1:'社交',2:'师承',3:'主从',4:'对立'}` 与真实 category 语义**不符**（真实 cat2 才是「对立」，cat3 = 主仆+师生）。app.html 以「只渲染实际存在的 cat」为准，chip 只出 3 个。

---

## 六、函数清单

| 函数 | 职责 | 文件 |
|---|---|---|
| `buildIndexes()` | 建 `nameById`/`edgeIndex`/`codeMeta`/`subCodeCount` | `_app-engine.js` |
| `visibleEdges()` | 统一过滤（relFilter ∧ catFilter ∧ statusFilter ∧ maxChapter） | engine |
| `setView(v, opt)` / `setState(patch)` | 视图切换 / 状态合并 + 重绘分派 | engine |
| `renderAll()` / `initForceSim()` / `applyLayout()` | 全图（从 A 移植） | engine |
| `renderFocus(center)` | 聚焦三栏（从 B 移植） | engine |
| `renderMatrix()` / `cellCount(a,b)` | 7×7 矩阵（改造 C） | engine |
| `openDetail(a,b)` / `closeDetail()` | 详情卡开合 + `highlightPairs` | `_app-matrix-detail.js` |
| `buildPairDetail()` / `buildDiagDetail()` / `edgeRow()` / `renderDetailCard()` | 详情卡装配与渲染 | detail |
| `renderEvo()` / `renderEvoLegend()` | 演化图（从 C 移植，改用 `visibleEdges`） | engine |
| `bfs()` / `renderTimeline()` | 最短路径 / 时间轴（从 A 移植） | engine |
| `onThemeChange()` | 四主题切换后重绘**全部三个** Canvas | engine |

---

## 七、v1 视觉复刻约束

- **复用既有 class**：`.ui-card` 系列 / `.ui-badge[data-variant]` / `.tl-rel-chip` / `.gl-swatch` / `.gt-close` / `.gt-chip` / `.panel` 系列 / `.custom-scrollbar` / `.picker` / `.profile` / `.viewer-header`。
- **新增 CSS 仅限本页布局**（`.app-body` / `.aux-drawer` / `.card-detail` / `.cd-edge` 等），全部用 `var()` 消费令牌。
- **关系配色用 `--rel-*`**（上表四主题真实值），**不用 `--chart-N`**；Canvas 内一律经 `window.wyVar('--rel-x')` 读取。
- 节点/按钮/卡片等仍用 v1 token（`--primary` / `--card` / `--border`），两套不混用。

---

## 八、验收

### 更新既有三个校验脚本
- `_check_js.js`：`files` 加 `app.html`；`_app-engine.js` 单独 `new vm.Script` 校验
- `_check_logic.js`：加 `app.html` 与 engine 的纯逻辑断言（见下）
- `_check_structure.js`：加 `app.html`，锚点类名 `viewer-header / viewer-nav / graph-page-header / gt-iconbar / gt-panel / matrix-scroll / cell / ui-card / ui-badge / tl-rel-chip / gl-swatch / panel / timeline / picker / profile / theme-toggle / custom-scrollbar`

### 新增断言（全部锚定已核实数字）
1. 子图内关系码 = **7 个**
2. `父子×兄弟` 命中 **杜少卿↔杜慎卿** 的 **3 条**关系（兄弟,朋友,父子）
3. 原文覆盖 **93 有 / 23 无**
4. `chapters[start].title` 无 off-by-one（spot check `chapters[2]` 含「第二回」、`chapters[31]` 含「第三十一回」）
5. 对角格数值：朋友 **92** / 同年 **1**
6. `陈木南` 存在且子图 **0 度**（空态路径）
7. 共现人物对 = **11**
8. 7×7 矩阵逐格比对基准表

### 手工验收
- 打开 `app.html` → 默认力导向全图；**切换四主题，三个 Canvas 全部变色**
- 点 `杜少卿` → 切聚焦视图，右栏显示 11 位邻居
- 点「矩阵与演化」→ 抽屉展开，矩阵是 **7×7**（无 夫妻/母子/仇敌 行）
- 点 `父子 × 兄弟` → 详情卡列出 **杜少卿 ↔ 杜慎卿** + **3 条**关系 + 回目名 + 原文 + 「关系特异」标
- 点 `朋友` 对角格 → 「92 组」，默认前 20 + 展开全部
- 点 `同年 × 同僚` → **1 组（王惠 ↔ 荀玫）**
- 查看 余大先生↔余二先生 兄弟 → 「无原文片段（证据计数 ev=1）」
- 关详情卡 → 全图高亮恢复
- A/B/C 三文件仍能独立打开且校验通过

---

## 九、风险与陷阱

| # | 陷阱 | 正确做法 |
|---|---|---|
| 1 | `degree` 是全库口径（873 实体） | 一律用 `SUB_DEG`（按 edges 实算） |
| 2 | `chapters[start+1]` 错位 | 只用 **`chapters[start].title`** |
| 3 | `evidence` 是**对象**非数组 | `D.evidence[e.id]`，先判空再判长度 |
| 4 | `ev` 是**数字**非数组 | 直接当计数显示，不 `.length` |
| 5 | `source`/`target` 是 **UUID** | 建 `nameById`；`_s`/`_t` 才是索引 |
| 6 | `codes[].n` 是全库边数 | 矩阵排序改用子图 `subCodeCount` |
| 7 | cat 真实只有 0/1/3 | chip 只渲染 0/1/3 |
| 8 | Canvas 读不到 CSS 变量 | 一律 `window.wyVar()`；关系色用 `--rel-*` |
| 9 | 切主题只重绘一个 Canvas | 事件里重绘**全图+聚焦+演化**三块 |
| 10 | 合并后三份 state 各自为政 | 单一 `window.__APP_STATE` |
| 11 | 对角格 `朋友` 92 组卡顿 | 默认 20 组 + 「展开全部」 |
| 12 | 抽屉开合导致 Canvas 宽度变化、力导向中心漂移 | 开关时 `resize()` + 更新 `sim.cx/cy` |
| 13 | `visibleEdges` 口径不一 | 引擎层统一，两套过滤取交集 |
| 14 | `exclusiveHits.pair` 是 UUID 串 | `split('|')` 后查 `nameById` 比较 |

---

## 十、交付文档与文件

**本方案文档**：`wenyuan-v3/docs/三视图合一-UI方案.md`（**权威副本**，2026-10-14 落盘）

| 类别 | 文件 |
|---|---|
| 新建 | `ui-demos/app.html` · `ui-demos/_app-engine.js` · `ui-demos/_app-matrix-detail.js` |
| 只读（复用） | `ui-demos/_data.js` · `_v1-tokens.css` · `_v1-components.css` · `_v1-theme-toggle.js` |
| 更新 | `ui-demos/_check_js.js` · `_check_logic.js` · `_check_structure.js` |
| 不动 | `A-力导向全图.html` · `B-聚焦视图.html` · `C-关系矩阵与演化.html` |

> ⚠️ **注意 `ui-demos/` 的归属**：`ui-demos/`（含 `_data.js`、四个校验脚本、A/B/C 三页）
> 位于**会话工作区** `WorkBuddy AI/2026-09-30-17-25-08/ui-demos/`，**不在 v3 仓库内**。
> 因此本方案中「新建/更新」的文件都落在**会话工作区**，**不进入 v3 的 `src`/`scripts`** ——
> 这也是它**不影响铁律⑤（`diff -rq src scripts` 差异 ⊆ 交付集）口径**的原因。

**文档维护约定（重要）**：
- 本方案以 **v3 项目内 `docs/三视图合一-UI方案.md` 为准**（本文件）；`~/.workbuddy-ai/plans/` 与会话侧 `ui-demos/PLAN-三视图合一.md` 为初稿/拷贝，可能过期。
- ⚠️ 本仓库历史上**四次**发生过「文档两副本不同步、被旧缓冲区覆盖」。因此**不要在多处分别维护**：若将来修改方案，**只改本文件**，改完核对 md5。
- 核对副本前，**必须先确认各副本的真身路径**：v3 内是 `//wsl$/Ubuntu/home/mwjz/code/wenyuan-v3/docs/`，会话侧是工作区扁平路径，两者统一用 `//wsl$/…` 或 `C:/…` 访问、**不要混用**。
