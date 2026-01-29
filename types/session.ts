export interface SessionEntity {
  name: string;
  prompt: string;
  system_prompt?: string | null;
}

export interface SessionConfiguration {
  study_type?: string | null;
  selected_models: string[];
  entities: SessionEntity[];
  summary_prompt?: string | null;
  temperature: number;
  files_config?: Record<string, any>;
  evaluation_config?: Record<string, any>;
}

export interface SessionDocument {
  file_hash: string;
  filename: string;
}

export interface ExtractionResult {
  entity_name: string;
  model_id: string;
  extracted_text?: string | null;
  status: "pending" | "completed" | "error";
  error_message?: string | null;
  extracted_at?: string | null;
}

export interface EvaluationScore {
  metric: string;
  score?: number | null;
  reasoning?: string | null;
  judge_model?: string | null;
}

export interface EvaluationResult {
  entity_name: string;
  model_id: string;
  ground_truth?: string | null;
  scores: EvaluationScore[];
  human_score?: number | null;
  evaluated_at?: string | null;
}

export interface Session {
  session_id: string;
  user_id: string;
  name: string;
  status: "in_progress" | "completed";
  created_at: string;
  updated_at: string;
  last_step?: string;
  configuration: SessionConfiguration;
  documents: SessionDocument[];
  extraction_results: ExtractionResult[];
  evaluation_results: EvaluationResult[];
}

export interface CreateSessionRequest {
  user_id: string;
  name?: string;
  configuration?: Partial<SessionConfiguration>;
  documents?: SessionDocument[];
}

export interface UpdateSessionRequest {
  user_id: string;
  name?: string;
  status?: "in_progress" | "completed";
  last_step?: string;
  configuration?: Partial<SessionConfiguration>;
  documents?: SessionDocument[];
  extraction_results?: ExtractionResult[];
  evaluation_results?: EvaluationResult[];
}

export interface SessionSummary {
  session_id: string;
  name: string;
  status: "in_progress" | "completed";
  created_at: string;
  updated_at: string;
  last_step?: string;
  study_type?: string | null;
  document_count: number;
  document_names: string[];
  extraction_count: number;
  evaluation_count: number;
}

export interface SessionListResponse {
  sessions: SessionSummary[];
  total: number;
}
