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

以下类型属于后续 adapter 范围，当前代码会识别为需要 MinerU/MarkItDown/Pandoc/OCR adapter，但不会承诺可转换：

```text
PDF
DOCX
PPTX
XLSX
图片
```

测试和部署验收时，不要把 Office/PDF/OCR 当成 v0.3.x 已完成能力。

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
