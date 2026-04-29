# 04 — 文档编辑器规格说明

## 1. 最高原则

```text
Milkdown 是编辑器能力边界。
Markdown 是持久化内容真相。
OpenKB 不发明独立 Markdown 方言。
```

OpenKB 支持的 Markdown 等于当前锁定 Milkdown 版本和启用插件能完整 round-trip 的 Markdown。

```text
Markdown source
  -> Milkdown parse
  -> editor state
  -> Milkdown serialize
  -> normalized Markdown
```

这个过程不能丢失语义。允许规范化空格、换行、代码块围栏等格式细节，但不能丢失标题、表格、链接、图片、列表、任务状态、代码、公式等语义。

## 2. Milkdown-native 方言定义

```text
OpenKB Markdown Dialect = locked Milkdown version + enabled Milkdown plugins/features
```

因此：

- CommonMark/GFM 只有在 Milkdown 配置实际启用时才算支持。
- Mermaid、LaTeX、callout、附件卡片、内部链接卡片必须通过 Milkdown plugin 或兼容扩展实现。
- 服务端 sanitizer、导入器、导出器、检索文本抽取都必须读取同一个 feature registry。
- 源码模式不能保存 Milkdown 无法 parse/serialize 的正文内容。

## 3. Feature Registry

必须维护统一的编辑器能力注册表。

建议文件：

```text
packages/editor/src/feature-registry.ts
```

示例类型：

```ts
export type EditorFeature = {
  key: string;
  label: string;
  milkdownPlugin: string;
  enabled: boolean;
  markdownSyntax: string[];
  supportsParse: boolean;
  supportsRender: boolean;
  supportsSerialize: boolean;
  supportsSearchExtraction: boolean;
};
```

所有模块都从 registry 获取能力：

```text
编辑器工具栏
slash menu
源码模式校验
导入器 Markdown 校验
服务端 sanitizer
搜索索引文本抽取
导出器
测试用例
```

## 4. 编辑页面布局

页面必须贴近语雀式文档体验：

```text
┌─────────────────────────────────────────────────────────────┐
│ 顶部栏：空间 / 知识库 / 文档面包屑、搜索、协作、分享、更多 │
├───────────────┬───────────────────────────────┬─────────────┤
│ 左侧目录树    │ 标题 + Milkdown 正文编辑器     │ 右侧大纲    │
│ 文件夹/文档   │ 阅读/编辑/源码模式             │ H1/H2/H3    │
└───────────────┴───────────────────────────────┴─────────────┘
```

### 左侧目录树

必须支持：

- 知识库目录。
- 文件夹。
- 文档。
- 新建文档。
- 新建文件夹。
- 重命名。
- 删除。
- 移动。
- 拖拽排序。
- 折叠/展开。
- 当前文档高亮。
- 按权限隐藏不可见文档。

### 主编辑区

必须支持：

- 标题输入。
- Milkdown 富文本式 Markdown 编辑。
- 阅读模式。
- 编辑模式。
- 源码模式。
- 自动保存状态。
- 保存中/已保存/保存失败提示。
- 版本冲突提示。
- 顶部协作与分享按钮。

### 右侧大纲

必须支持：

- 从当前 Markdown 标题生成。
- 点击跳转。
- 滚动高亮。
- 窄屏隐藏。

## 5. 编辑模式

| 模式 | 用途 | 要求 |
|---|---|---|
| 阅读模式 | 阅读文档 | 使用 Milkdown-compatible renderer。 |
| 可视化编辑模式 | 主编辑模式 | Milkdown WYSIWYG Markdown editor。 |
| 源码模式 | 兜底/开发者模式 | Monaco 或 textarea，但保存前必须通过 Milkdown parse。 |

## 6. 保存和版本

文档内容保存在 `document_versions.markdown`。

保存请求必须包含：

```text
document_id
base_version_id 或 base_version_no
markdown
markdown_hash
```

服务端检查：

```text
如果 base_version 不是当前版本 -> 返回 VERSION_CONFLICT。
如果用户无编辑权限 -> 返回 403。
如果 Markdown 无法通过 Milkdown 方言校验 -> 返回 MARKDOWN_DIALECT_ERROR。
```

## 7. 自动保存

- 编辑状态每隔固定时间或内容变化后 debounce 自动保存。
- 页面离开前提示未保存变更。
- 自动保存失败必须可见。
- 不做实时多人协作，v0.x 只做乐观锁。

## 8. 内部链接

可以实现本项目文档链接：

```md
[文档标题](openkb://document/{document_id})
```

渲染时转换为 Web URL。源码模式仍然必须是 Milkdown 可处理的普通链接或兼容插件节点。

## 9. 资源引用

图片和附件存对象存储，Markdown 中使用稳定引用：

```md
![图片](asset://asset_id)
```

读取时由 API 转成带权限校验的临时 URL。附件下载必须检查文档读权限。

## 10. 导入文档校验

文件转换出的 Markdown 不能直接入库。必须：

```text
转换器输出 Markdown
  -> Milkdown parse/serialize 测试
  -> sanitizer
  -> normalized Markdown
  -> 保存版本
```

不能被 Milkdown 表示的内容：

- 转为 asset。
- 转为只读 HTML block 前必须明确标记。
- 或等待插件支持。

## 11. 测试要求

必须有：

- 每个 enabled feature 的 parse/render/serialize round-trip 测试。
- 源码模式非法 Markdown 保存失败测试。
- 自动保存冲突测试。
- 目录树权限隐藏测试。
- 内部链接和 asset 链接渲染测试。
