# Agent Note: 助手 Markdown 的 Mermaid 图表

Status: implemented

[English](2026-09-17-assistant-markdown-mermaid-diagrams.md) | 中文

## 问题

包含 ` ```mermaid ` 代码块的助手回复此前只渲染为普通的语法高亮代码，模型编写的图表以源文本而非图形呈现。Web GUI 的 Markdown 管线此前完全没有 Mermaid 环节：唯一特殊处理的代码块语言是 `math`(提升为展示级 TeX),且原始 HTML 被刻意按字面文本处理,因此即使是预先渲染好的 SVG 也无法通过。

## 决策

已定型(settled)的 ` ```mermaid ` 代码块现在渲染为图表。该改动位于无 Cordis 的 [ui-primitives Markdown 管线](../../../../packages/client/ui-primitives/src/markdown/render.tsx) 中,与现有的 `math` 分支并列:`renderCode()` 将已定型的 `mermaid` 代码块路由到新的 [`MermaidBlock`](../../../../packages/client/ui-primitives/src/markdown/MermaidBlock.tsx),而不是通用的 `CodeBlock`。在回复流式输出期间,该代码块保持为普通的高亮源代码块——与"TeX 在定型前保持字面文本"的规则一致——因此不完整的图源不会闪现渲染错误。

Mermaid 和 `@mermaid-js/layout-elk` 按需懒加载。加载器注册 ELK，并将使用共享布局的图表默认设为分层算法；具有专用渲染器的图表类型保留各自的布局。布局加载器必须注册：仅设置 `layout: 'elk'` 会静默回退到 Dagre。[`mermaid.ts`](../../../../packages/client/ui-primitives/src/markdown/mermaid.ts) 加载器将这个庞大的模块藏在动态 `import('mermaid')` 之后,以 `startOnLoad: false`、`securityLevel: 'strict'`(助手输出不可信)和 `suppressErrorRendering: true` 初始化一次,并在每次渲染的唯一 id 下渲染为 SVG 字符串,使 ID 作用域的样式和片段引用不会跨图表冲突。之所以抑制错误渲染,是因为 Mermaid 否则会把自身的错误图表留在 `document.body` 中、挂在永不重用的 id 下,使源代码块回退在每个畸形代码块出现时都被一个多余的错误图形伴随。没有图表的会话既不需加载该模块也不需初始化。首次渲染通过 `useSyncExternalStore` 快照通知订阅者,效仿 [`highlight.ts`](../../../../packages/client/ui-primitives/src/markdown/highlight.ts) 中懒加载 shiki 语法的模式。

解析或渲染失败的图表——以及 Mermaid 分块始终未加载的图表——回退到普通的、完整带标签的源 `CodeBlock`,因此图表文本永不丢失。被拒绝的分块导入会记为终态加载状态而不再重试,因此不会在每次渲染时重启,该拒绝被吸收而不会表现为未处理的 rejection。可选的本地化说明(`MarkdownLabels.mermaid.error`)在源代码块上方解释失败原因;该字段是可选的,因此构建 `MarkdownLabels` 的五个功能包不会因新增必需属性而破坏,每个包都可以在本地化后选择加入该说明。SVG 是 Mermaid 自己净化后的输出,通过与渲染器已用于 shiki 和 KaTeX 生成标记相同的 `dangerouslySetInnerHTML` 信任路径注入。

成功渲染的图表在功能提供 `MarkdownLabels.mermaid.toolbar` 时携带可选的缩放/保存工具栏(第二个可选组,因此仅提供错误说明的包同样不受影响)。缩放通过 CSS transform 在可滚动视口中将 SVG 从 25% 放大到 400%,放大的图表通过滚动平移;重置回到 100%;保存将实时 SVG(连同 Mermaid 内嵌样式)序列化为 `.svg` 下载。聊天界面通过共享的 common 命名空间字典(`markdown.mermaid.*`)接入这些标签,因此主对话视图获得该工具栏。缩放和平移是瞬态查看状态——不持久化,也不进入会话日志,遵循 Web 层纯粹性规则。

工具栏的本地化源码开关通过 `CodeBlock` 展示原始代码块正文及其复制控件。源码视图隐藏 SVG 视口和仅用于图表的控件，但不卸载 SVG，因此切回图表时保留其 DOM、缩放和滚动位置，无需再次调用 Mermaid 渲染。源码为只读：开关只改变显示方式，不修改已记录的助手消息。选中的视图与缩放一样保留在组件本地，不新增会话事件或持久化设置。

## 考虑过的替代方案

**Conversation-Node 渲染器。** `ConversationNodeDefinition` 加上带键的聊天节点渲染器是把*会话事件*渲染为聊天节点;Mermaid 代码块是助手 Markdown 的内联内容,不是事件,因此 Markdown 的 `renderCode` 分支才是正确的层。节点路线还会把图表处理从所有聊天界面共享的唯一 Markdown 管线中分散出去。

**流式期间渲染。** 每个数据块都重新运行 Mermaid 会在每个不完整的中间源上抛出解析错误,并每次重启布局。将代码块保持为源代码块直到定型,与既有的 math 代码块行为一致,且图表只渲染一次。

**必需的 `mermaid` 标签组。** 将错误说明设为必需会迫使所有五个 `MarkdownLabels` 构建者在同一 PR 中修改,并在修改前无法通过类型检查。可选字段在已本地化的地方提供说明,而没有这种耦合;源回退本身已经传达了失败。

**急切打包 Mermaid。** Mermaid 体积庞大且需要真实 DOM;在启动时导入会让每个会话都为大多数回复用不到的功能付出代价。动态导入将该成本限制在第一个图表上。

**为工具栏引入平移缩放库。** 专用库(如文档站 Mermaid 查看器所用)会为一个用 CSS `transform: scale()` 加可滚动视口即可覆盖的控件增加直接依赖和手势机制,而无需新依赖。若日后需要自由拖拽平移,仍可走库的路线;滚动平移已经能处理放大的图表。

**按图表持久化缩放。** 缩放是瞬态查看状态,如同代码块的滚动位置;持久化它会为无持久需求增加持久状态,并把纯展示数据放到会话日志附近,这违反 Web 层纯粹性规则。

## 后果

Web GUI 现在渲染模型编写的 Mermaid 图表,代价是 Mermaid 及其 ELK 布局依赖，两者均为按需加载的浏览器专用构建输入。jsdom 无法运行 Mermaid 的 SVG 布局(`getBBox` 未实现),因此组件测试 stub 加载器模块并固定代码块的状态机——加载中、完成、失败——而非 Mermaid 自身的渲染;真实渲染由浏览器冒烟路径覆盖。仅定型的规则意味着图表在定型时出现,而非渐进出现。可选的错误说明意味着尚未本地化的功能会显示没有解释性文字的源回退。缩放/保存工具栏只在功能提供其标签的地方出现(今天是聊天视图,通过 common 命名空间);未提供的功能得到的是裸图表。缩放无需新依赖,也无需持久状态。
