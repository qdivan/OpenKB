# 12 — 文件导入和 Markdown 转换

## 1. 原则

所有文件导入最终都转换为：

```text
Markdown + assets + metadata + source file reference
```

Markdown 必须通过 Milkdown 当前启用插件的 parse/serialize 校验。

## 2. 当前支持文件

当前代码已启用的转换器：

```text
Markdown
Text
HTML
CSV
```

以下类型依赖系统级 adapter。OpenKB 会识别它们并按配置路由到 MinerU、MarkItDown、Pandoc 或 OCR；如果对应工具未配置、不可用、超时或鉴权失败，导入任务会以稳定错误结束并展示失败原因：

```text
PDF
DOCX
PPTX
XLSX
图片
```

测试和部署验收时，需要区分“OpenKB 导入任务链路可追踪”和“外部转换工具真实可用”。PDF/MinerU 能否成功取决于实例级导入工具配置和 worker 运行状态。

## 3. 转换器接口

```ts
interface DocumentConverter {
  name: string;
  supports(input: ConvertInput): boolean;
  convert(input: ConvertInput): Promise<ConvertResult>;
}

type ConvertResult = {
  markdown: string;
  assets: ConvertedAsset[];
  intermediateJson?: unknown;
  warnings?: string[];
  confidence?: number;
};
```

## 4. 后续推荐转换器

- MinerU：PDF、扫描 PDF、图片、复杂版面。
- MarkItDown：Office、HTML、CSV 等轻量转换。
- Pandoc：通用兜底。

转换器是 adapter，不是主系统依赖边界。

## 5. 导入流程

```text
upload file
  -> save original to object storage
  -> create import_job
  -> show import job in Web task panel
  -> converter worker
  -> markdown + assets
  -> Milkdown parse/serialize validation
  -> create document/version
  -> generate chunks with current KB chunk settings
  -> user publishes document when ready
  -> admin Milvus index rebuild indexes published current-version chunks
```

## 6. 复杂内容处理

- 简单表格：GFM table，前提是 Milkdown 当前 table feature 支持。
- 复杂表格：只读 HTML block 或 asset。
- 图表：图片 asset + alt text。
- 公式：只有 Milkdown 对应插件启用时才可编辑，否则转 asset/只读块。
- 无法表示的内容：不能静默丢弃，必须记录 warning。

## 7. Phase 19 复杂导入适配器

Phase 19 起，复杂格式不再停留在“识别但不可转换”的状态，而是通过系统级导入工具路由处理：

```text
pdf   -> MarkItDown -> MinerU
docx  -> MarkItDown -> Pandoc -> MinerU
pptx  -> MarkItDown -> Pandoc -> MinerU
xlsx  -> MarkItDown -> Pandoc -> MinerU
image -> MarkItDown -> Tesseract OCR -> MinerU
```

规则：

- 工具配置是实例级基础设施配置，只能由 `system_admin` 在 `/app/admin/import-tools` 管理。
- 不提供租户级、工作区级或知识库级导入工具配置。
- API key 只能在 `OPENKB_CONFIG_ENCRYPTION_KEY` 存在时以 AES-256-GCM 密文保存；DTO、审计和日志不得出现 raw secret。
- Worker 对 `auto` 导入按格式路由依次尝试主工具和 fallback；失败尝试会写入 `import_jobs.warnings`。
- 所有 adapter 输出都必须通过 `validateMarkdownForImport()`，不符合 Milkdown/Feature Registry 的 Markdown 以 `MARKDOWN_DIALECT_ERROR` 失败。
- 外部工具不可用、未配置、超时、鉴权失败时必须返回稳定 code：`IMPORT_TOOL_NOT_CONFIGURED`、`IMPORT_TOOL_UNAVAILABLE`、`IMPORT_TOOL_TIMEOUT`、`IMPORT_TOOL_AUTH_FAILED` 或 `CONVERTER_UNAVAILABLE`。
- 工具提取出的 media 写入 S3-compatible storage，并作为 `document_assets` 绑定到导入后创建的文档。

## 8. 导入进度与故障可见性

Web 创建导入任务后，会立即把任务放入导入任务面板，并轮询状态：

```text
pending
running
succeeded
failed
```

任务 DTO 会返回安全状态字段：job id、标题、源文件名、转换器、创建/更新时间、完成时间、错误和 warnings。成功后刷新文档树；失败时显示 worker 或转换工具返回的错误。

如果任务长时间停留在 `pending` 或 `running` 且没有更新时间变化，Web 会提示检查导入工作器、MinerU adapter 或外部转换超时。导入成功与否不能只藏在 toast 中；任务面板是用户追踪导入状态的固定入口。
