-- Chunked campaign ingestion: no total recipient cap. Uploads remain held until finalized.
CREATE TABLE IF NOT EXISTS campaign_upload_chunks (
  workspace_id TEXT NOT NULL, campaign_id TEXT NOT NULL, chunk_id TEXT NOT NULL,
  request_hash TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id,campaign_id,chunk_id)
);
CREATE INDEX IF NOT EXISTS idx_campaign_pending_work ON campaign_recipients(workspace_id,campaign_id,status,message_id);
