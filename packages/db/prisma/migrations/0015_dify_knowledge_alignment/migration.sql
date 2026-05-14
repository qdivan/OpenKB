ALTER TABLE knowledge_base_chunk_settings
  ADD COLUMN doc_form text NOT NULL DEFAULT 'hierarchical_model',
  ADD COLUMN indexing_technique text NOT NULL DEFAULT 'high_quality',
  ADD COLUMN process_rule_mode text NOT NULL DEFAULT 'hierarchical',
  ADD COLUMN process_rule jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN retrieval_model jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN summary_index_setting jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE knowledge_base_chunk_settings
  ADD CONSTRAINT knowledge_base_chunk_settings_doc_form_check
    CHECK (doc_form IN ('text_model', 'hierarchical_model', 'qa_model')),
  ADD CONSTRAINT knowledge_base_chunk_settings_indexing_technique_check
    CHECK (indexing_technique IN ('economy', 'high_quality')),
  ADD CONSTRAINT knowledge_base_chunk_settings_process_rule_mode_check
    CHECK (process_rule_mode IN ('automatic', 'custom', 'hierarchical'));

UPDATE knowledge_base_chunk_settings
SET doc_form = CASE WHEN mode = 'general' THEN 'text_model' ELSE 'hierarchical_model' END,
    process_rule_mode = CASE WHEN mode = 'general' THEN 'custom' ELSE 'hierarchical' END,
    process_rule = jsonb_build_object(
      'pre_processing_rules',
      jsonb_build_array(
        jsonb_build_object('id', 'remove_extra_spaces', 'enabled', true),
        jsonb_build_object('id', 'remove_urls_emails', 'enabled', false)
      ),
      'segmentation',
      jsonb_build_object(
        'separator', parent_delimiter,
        'max_tokens', parent_max_characters,
        'chunk_overlap', 0
      ),
      'parent_mode',
      CASE WHEN parent_mode = 'full_doc' THEN 'full-doc' ELSE 'paragraph' END,
      'subchunk_segmentation',
      jsonb_build_object(
        'separator', child_delimiter,
        'max_tokens', child_max_characters,
        'chunk_overlap', child_overlap_characters
      )
    ),
    retrieval_model = jsonb_build_object(
      'search_method', 'full_text_search',
      'top_k', 10,
      'score_threshold_enabled', false,
      'score_threshold', 0,
      'reranking_enable', false,
      'reranking_mode', 'weighted_score',
      'weights', jsonb_build_object('vector_setting', jsonb_build_object('vector_weight', 0.5), 'keyword_setting', jsonb_build_object('keyword_weight', 0.5)),
      'metadata_filtering_conditions', null
    ),
    summary_index_setting = jsonb_build_object('enable', false);

ALTER TABLE documents
  ADD COLUMN doc_form text,
  ADD COLUMN process_rule_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN processing_status text NOT NULL DEFAULT 'current',
  ADD COLUMN processing_revision integer NOT NULL DEFAULT 1,
  ADD COLUMN doc_language text,
  ADD COLUMN need_summary boolean NOT NULL DEFAULT false;

ALTER TABLE documents
  ADD CONSTRAINT documents_doc_form_check
    CHECK (doc_form IS NULL OR doc_form IN ('text_model', 'hierarchical_model', 'qa_model')),
  ADD CONSTRAINT documents_processing_status_check
    CHECK (processing_status IN ('current', 'needs_reprocess', 'processing', 'failed'));

ALTER TABLE document_chunks
  ADD COLUMN status text NOT NULL DEFAULT 'active',
  ADD COLUMN override_content_text text,
  ADD COLUMN override_content_markdown text,
  ADD COLUMN overridden_by uuid,
  ADD COLUMN overridden_at timestamptz,
  ADD COLUMN disabled_at timestamptz;

ALTER TABLE document_chunks
  ADD CONSTRAINT document_chunks_status_check
    CHECK (status IN ('active', 'disabled', 'deleted'));

CREATE INDEX document_chunks_status_idx ON document_chunks(status);

CREATE TABLE document_qa_pairs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  knowledge_base_id uuid NOT NULL,
  document_id uuid NOT NULL,
  question text NOT NULL,
  answer text NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'active',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_qa_pairs_source_check CHECK (source IN ('manual', 'csv', 'llm')),
  CONSTRAINT document_qa_pairs_status_check CHECK (status IN ('active', 'disabled', 'deleted'))
);

CREATE INDEX document_qa_pairs_tenant_idx ON document_qa_pairs(tenant_id);
CREATE INDEX document_qa_pairs_workspace_idx ON document_qa_pairs(workspace_id);
CREATE INDEX document_qa_pairs_kb_idx ON document_qa_pairs(knowledge_base_id);
CREATE INDEX document_qa_pairs_document_idx ON document_qa_pairs(document_id);
CREATE INDEX document_qa_pairs_status_idx ON document_qa_pairs(status);

CREATE TABLE document_segment_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  knowledge_base_id uuid NOT NULL,
  document_id uuid NOT NULL,
  chunk_id uuid NOT NULL,
  summary text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_segment_summaries_chunk_unique UNIQUE (chunk_id),
  CONSTRAINT document_segment_summaries_status_check CHECK (status IN ('active', 'disabled', 'deleted'))
);

CREATE INDEX document_segment_summaries_tenant_idx ON document_segment_summaries(tenant_id);
CREATE INDEX document_segment_summaries_workspace_idx ON document_segment_summaries(workspace_id);
CREATE INDEX document_segment_summaries_kb_idx ON document_segment_summaries(knowledge_base_id);
CREATE INDEX document_segment_summaries_document_idx ON document_segment_summaries(document_id);
CREATE INDEX document_segment_summaries_status_idx ON document_segment_summaries(status);
