# 灵感广场 Vue -> React 迁移指南

## 1. 迁移范围

本指南覆盖当前 Vue 页面：

- `src/views/console-stage/inspiration/index.vue`
- `src/views/console-stage/inspiration/comps/InspirationDetailModal.vue`
- `src/utils/inspiration-create-same.ts`

现状结论：页面没有调用 `request`、`axios`、`fetch` 或 `src/api` 中的接口。所有业务数据均为前端静态数据。React 首次迁移应先保留静态数据，确认交互一致后再接入真实接口。

## 2. 数据清单与关系

| 数据集 | 数量 | 当前用途 | 迁移处理 |
| --- | ---: | --- | --- |
| `inspirationData` | 16 条 | 详情、关联推荐 | 完整保留为详情查找表 |
| `inspirationCards` | 6 条 | 当前实际渲染的视频卡片 | 完整保留为网格列表 |
| `featuredItems` | 7 条 | 精选横向列表 | 数据保留；当前 Vue 模板已注释，默认不渲染 |
| `cultureCategoryTabs` | 7 项 | 分类筛选与数量 | 完整保留 |

关系如下：

```text
inspirationCards[].dataKey  ───────> inspirationData[dataKey]
featuredItems[].dataKey     ───────> inspirationData[dataKey]
inspirationData[id].relatedIds[] ─> inspirationData[relatedId]
```

详情 ID：`sanxingdui`、`bianlian`、`panda`、`shuxiu`、`zhubian`、`emeishan`、`lianpu`、`luodai`、`dujiangyan`、`gongzitung`、`taohua`、`baojing`、`teahouse`、`hotpot`、`chuancai`、`baizhu`。

注意：

- 网格卡片的数字 `id` 仅是列表 key；详情和关联关系实际使用字符串 `dataKey`。React 中建议统一使用字符串 `inspirationId`。
- `bgStyle` 与 `bgImg` 信息重复。React 中保留 `imageUrl` 并派生 `backgroundImage`，无需执行 Vue 的 CSS 字符串。
- `featuredItems` 是一套独立静态展示数据，不一定与详情统计一致。例如 `hotpot` 的精选统计与详情统计不同；迁移时先原样保留，不要擅自合并。
- 详情数据中没有实际 `coverImage`，详情弹窗应保留“分类色渐变 + emoji”占位图。

## 3. 当前行为与产品决策点

| 当前行为 | React 迁移方式 | 备注 |
| --- | --- | --- |
| 搜索标题、分类、提示词 | 受控输入 + 派生列表 | 匹配不区分大小写 |
| 点击分类 | `setActiveCategory(tab.key)` | 分类数量只受搜索词影响，保持原逻辑 |
| 点击网格卡片封面 | 打开视频预览 | 当前不是打开详情 |
| Enter / Space 打开视频 | `onKeyDown` | React 建议用语义化按钮，避免嵌套可交互元素 |
| 点击“创作同款” | 写入 sessionStorage 后跳转 | 见第 7 节固定协议 |
| 详情弹窗 | 根据详情 ID 查表 | 当前可见网格没有详情入口；精选区被注释后，详情几乎不可达 |
| 关联推荐 | `relatedIds` 查表，最多 3 条 | 点击后切换当前详情 ID |
| 收藏 | 仅 toast 提示 | 没有持久化和接口 |
| 加载更多 | 仅 toast 提示 | 对应模板也被注释 |

迁移前需明确一个产品决策：React 版是否增加“查看详情”入口。若保持现状，卡片点击只预览视频；若增加入口，应使用独立的“查看详情”按钮，避免把视频播放和详情打开绑定到同一次点击。

## 4. 推荐 React 目录

```text
src/features/inspiration/
  data/
    inspirations.ts
    category-tabs.ts
  types.ts
  hooks/
    useInspirationGallery.ts
  components/
    InspirationHero.tsx
    CategoryTabs.tsx
    InspirationGrid.tsx
    InspirationCard.tsx
    VideoPreviewDialog.tsx
    InspirationDetailDialog.tsx
    FeaturedInspirations.tsx       # 可选，当前页面默认不迁移
  pages/
    InspirationPage.tsx
  inspiration.module.scss
```

- `InspirationPage`：组合页面，负责路由跳转、当前视频和当前详情 ID。
- `useInspirationGallery`：筛选、分类计数、详情查找、关联推荐等纯数据逻辑。
- `InspirationGrid` / `InspirationCard`：6 条视频卡片与“创作同款”操作。
- `VideoPreviewDialog`：视频播放、遮罩关闭、ESC、滚动锁定。
- `InspirationDetailDialog`：详情、参考资料、关联推荐、收藏和基于灵感创作。

不要把整个 Vue 单文件组件直接迁入一个 React 组件；页面有搜索、筛选、媒体预览、详情弹窗和路由跳转等独立职责。

## 5. Vue 与 React 对照

| Vue | React |
| --- | --- |
| `ref` | `useState` / `useRef` |
| `computed` | render 时直接派生或 `useMemo` |
| `onMounted/onUnmounted` | `useEffect` 与 cleanup |
| `v-model` | `value` + `onChange` |
| `v-for` | `array.map()` |
| `v-if/v-show` | 条件渲染 / 持续挂载并切换样式 |
| `@click/@keydown` | `onClick/onKeyDown` |
| `$emit` | 回调 props，例如 `onClose` |
| `BaseModal` 插槽 | 目标项目已有 Dialog 的组合 API 或 children |
| `useRouter` | React Router 的 `useNavigate` |

最小状态建议：

```tsx
const [query, setQuery] = useState('');
const [activeCategory, setActiveCategory] =
  useState<CultureTabKey>('all');
const [selectedVideo, setSelectedVideo] =
  useState<InspirationCard | null>(null);
const [selectedInspirationId, setSelectedInspirationId] =
  useState<InspirationId | null>(null);
```

`modalVisible` 与 `videoPreviewVisible` 不必单独保存，分别由 `selectedInspirationId !== null` 和 `selectedVideo !== null` 推导。当前 `activeFilter` 未使用，不迁移。

核心筛选逻辑：

```tsx
const matchesQuery = (card: InspirationCard, raw: string) => {
  const query = raw.trim().toLowerCase();
  return !query || [card.title, card.category, card.prompt]
    .some((value) => value.toLowerCase().includes(query));
};

const filteredCards = useMemo(() => {
  return inspirationCards.filter((card) =>
    (activeCategory === 'all' || card.tabKey === activeCategory) &&
    matchesQuery(card, query),
  );
}, [activeCategory, query]);

const categoryCounts = useMemo(() => {
  const counts: Record<CultureTabKey, number> = {
    all: 0, ancient: 0, opera: 0, panda: 0,
    teahouse: 0, craft: 0, scenery: 0,
  };

  for (const card of inspirationCards) {
    if (!matchesQuery(card, query)) continue;
    counts.all += 1;
    counts[card.tabKey] += 1;
  }
  return counts;
}, [query]);
```

## 6. 类型和数据模块

将附录中的完整数据复制至 `data/inspirations.ts`。建议先保持现有展示字段，后续接 API 时在 `api/inspirations.ts` 中把服务端 DTO 转换成相同领域模型。

```ts
export type InspirationId = string;
export type CultureTabKey =
  | 'all'
  | 'ancient'
  | 'opera'
  | 'panda'
  | 'teahouse'
  | 'craft'
  | 'scenery';

export interface InspirationDetail {
  id: InspirationId;
  icon: string;
  category: string;
  categoryColor: string;
  title: string;
  author: string;
  authorAvatar: string;
  authorTitle: string;
  authorWorks: number;
  authorFollowers: string;
  date: string;
  likes: string;
  views: string;
  saves: number;
  tags: string[];
  highlights: Array<{ icon: string; label: string; value: string }>;
  summary: string;
  sections: Array<{ title: string; content: string }>;
  references: Array<{ icon: string; title: string; type: string }>;
  relatedIds: InspirationId[];
  coverImage?: string;
}

export interface InspirationCard {
  id: string;
  inspirationId: InspirationId;
  tabKey: Exclude<CultureTabKey, 'all'>;
  title: string;
  category: string;
  icon: string;
  tags: string[];
  author: string;
  authorName: string;
  likes: string;
  saved: boolean;
  imageUrl: string;
  videoUrl: string;
  prompt: string;
}
```

当前展示量为字符串（例如 `2.8k`）。若后端可以调整，建议传数值并在前端格式化；首次迁移不要改变原有字符串。

## 7. 路由与存储协议

“创作同款”必须保留以下协议，除非 React 目标项目同步修改创建页的读取逻辑：

```ts
const INSPIRATION_CREATE_SAME_STORAGE_KEY =
  'cclaw-inspiration-create-same-prompt';
const INSPIRATION_CREATE_SAME_QUERY = 'fromInspirationSame';

sessionStorage.setItem(
  INSPIRATION_CREATE_SAME_STORAGE_KEY,
  JSON.stringify({ prompt: card.prompt }),
);
navigate('/cclaw/new-task?fromInspirationSame=1');
```

`/cclaw/new-task` 是当前 Vue 项目的路由；迁入新项目时替换为目标创建页路径，并让该页按同一 key 读取 prompt。顶部“开始创作”只跳转，不写入 prompt。

## 8. 资源迁移

复制以下本地资源或在目标项目重新映射：

| 用途 | 原路径 |
| --- | --- |
| 页面主视觉 | `@/assets/imgs/home/inspiration-nav.png` |
| 顶部创建图标 | `@/assets/imgs/home/create-icon.png` |
| 创作同款图标 | `@/assets/imgs/home/start-creation.png` |
| 分类图标 | `@/assets/imgs/home/inspiration-tab-1.png` 至 `inspiration-tab-7.png` |
| 详情元数据图标 | `@/assets/imgs/home/date-icon.png`、`like-icon.png`、`view-icon.png`、`collect-icon.png` |

6 条网格数据引用外部媒体：

```text
https://s3-cn-south-1.scstit.com:9083/wenchuangxia/{1..6}.jpg
https://s3-cn-south-1.scstit.com:9083/wenchuangxia/{1..6}.mp4
```

迁移前在目标环境验证这些 URL 的 HTTPS、CORS、视频加载、首帧和失败降级。若不能稳定访问，应先下载并托管到目标项目允许的媒体域。

## 9. 样式、可访问性与安全

- Vue 样式包含 `:deep()` 对 `BaseModal`/Element Plus 的覆盖，不能直接复制；应按目标 Dialog 组件的 DOM 结构重写。
- 当前详情内容通过 `v-html` 把 `**粗体**` 转为 HTML。React 中不要直接对后端内容使用 `dangerouslySetInnerHTML`；静态数据可安全解析为 React 节点，服务端内容必须经过可信的 Markdown 渲染与消毒。
- 视频和详情 Dialog 必须处理 ESC、关闭按钮、遮罩关闭、焦点管理及滚动锁定。使用目标项目已有的 Dialog 组件优先；手动实现时在 effect cleanup 中恢复原始 `document.body.style.overflow`。
- 原网格使用可聚焦 `div`，且内部还有按钮。React 版使用独立按钮或分离的媒体区域，避免嵌套交互控件。

## 10. 建议迁移顺序

1. 复制资源和附录的静态数据，保证 UTF-8 编码。
2. 将 `dataKey` 规范化为 `inspirationId`，`bgImg`/ `video` 规范化为 `imageUrl`/ `videoUrl`；保留原 ID 值。
3. 完成 Hero、分类、搜索、网格和原样 CSS 的视觉迁移。
4. 接入视频 Dialog、键盘关闭、滚动锁定和“创作同款”协议。
5. 根据产品决策添加详情入口，再接入详情 Dialog 与关联推荐。
6. 将收藏、加载更多、详情创作从当前占位提示替换成明确的 API 或路由协议。
7. 最后再接真实接口，避免 UI、数据结构和接口问题同时排查。

建议覆盖以下测试：搜索/分类计数、6 个媒体 URL、视频关闭、ESC、sessionStorage 写入、创建页跳转、关联推荐、详情缺失时的降级与 Dialog 焦点。

## 11. 后续接口边界（当前不存在）

若后续需要接口化，建议先将 React UI 固定在以下领域模型上：

- `GET /inspirations?q=&category=&page=&pageSize=`：列表卡片与总数。
- `GET /inspirations/:id`：完整详情和 `relatedIds`。
- `POST /inspirations/:id/favorite` / `DELETE /inspirations/:id/favorite`：收藏。

不要在卡片组件内分别请求详情；列表和详情应由页面或数据层统一读取，避免请求瀑布。数据量较大时，详情弹窗可在用户准备打开时预取。

## 附录：完整静态数据

以下代码由当前 Vue 页面数据区逐字迁移，并仅做了 React 适配：

- `ref([...])` 改为普通数组导出。
- `inspirationData` 的 `any` 改为 `InspirationDetail`。
- 分类图标改为文件名，目标项目可改为静态 URL 或图片 import。
- 其余详情、列表、媒体 URL、提示词、统计、引用和关联 ID 全部保留。

<!-- STATIC_DATA_APPENDIX -->
