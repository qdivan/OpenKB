Implement the first version of the Markdown editor page.

Scope:
- Milkdown editor integration.
- Feature Registry in packages/editor.
- Markdown-first storage.
- Document read/edit route.
- Left document tree.
- Right outline generated from headings.
- Save Markdown content through API.
- Version conflict handling using current document version.

Rules:
- Markdown dialect follows enabled Milkdown features exactly.
- Do not define a custom Markdown subset.
- Source mode must validate through Milkdown parse/serialize.
- Do not implement real-time collaboration yet.
- Do not implement table document or mind map document.
- Only rich-text Markdown document type for now.
