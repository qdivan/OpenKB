export const MARKDOWN_PACKAGE_NAME = "@openkb/markdown";
export const MARKDOWN_DIALECT_OWNER = "milkdown";

export type MarkdownScaffoldStatus = {
  packageName: typeof MARKDOWN_PACKAGE_NAME;
  dialectOwner: typeof MARKDOWN_DIALECT_OWNER;
  customDialectImplemented: false;
};

export const markdownScaffoldStatus: MarkdownScaffoldStatus = {
  packageName: MARKDOWN_PACKAGE_NAME,
  dialectOwner: MARKDOWN_DIALECT_OWNER,
  customDialectImplemented: false
};
