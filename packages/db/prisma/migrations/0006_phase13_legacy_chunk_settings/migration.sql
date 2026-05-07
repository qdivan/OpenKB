INSERT INTO knowledge_base_chunk_settings (
  tenant_id,
  workspace_id,
  knowledge_base_id,
  mode,
  parent_mode,
  updated_by
)
SELECT
  kb.tenant_id,
  kb.workspace_id,
  kb.id,
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM document_chunks c
      WHERE c.knowledge_base_id = kb.id
        AND c.chunk_type = 'general'
    ) THEN 'general'
    ELSE 'parent_child'
  END,
  'paragraph',
  kb.created_by
FROM knowledge_bases kb
WHERE NOT EXISTS (
  SELECT 1
  FROM knowledge_base_chunk_settings settings
  WHERE settings.knowledge_base_id = kb.id
);

UPDATE knowledge_base_chunk_settings settings
SET
  mode = 'general',
  updated_at = now()
WHERE settings.mode = 'parent_child'
  AND EXISTS (
    SELECT 1
    FROM document_chunks c
    WHERE c.knowledge_base_id = settings.knowledge_base_id
      AND c.chunk_type = 'general'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM document_chunks c
    WHERE c.knowledge_base_id = settings.knowledge_base_id
      AND c.chunk_type IN ('parent', 'child')
  );
