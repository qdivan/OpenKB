ALTER TABLE document_qa_pairs
  DROP CONSTRAINT IF EXISTS document_qa_pairs_source_check;

ALTER TABLE document_qa_pairs
  ADD CONSTRAINT document_qa_pairs_source_check
    CHECK (source IN ('manual', 'csv', 'llm', 'mock'));
