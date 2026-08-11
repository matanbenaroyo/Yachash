/**
 * Shared types for the מערך היח״ש AI chatbot module.
 *
 * This module is deliberately separate from the bulk-campaign sending path: it
 * reuses WhatsAppManager for transport and the existing SQLite database, but no
 * campaign/warm-up code depends on anything here.
 */

/** Intents the AI can route an incoming message to. */
export type ChatbotIntent =
  | 'VEHICLE_ENTRY'
  | 'ORDER_DISTRIBUTION'
  | 'REPLACEMENT_SCHEDULE'
  | 'OPEN_CALL'
  | 'DEVELOPMENT_TRACKS'
  | 'GENERAL_QUESTION'
  | 'SENIOR_STAFF'
  | 'OTHER'
  | 'UNKNOWN';

export const CHATBOT_INTENTS: ChatbotIntent[] = [
  'VEHICLE_ENTRY',
  'ORDER_DISTRIBUTION',
  'REPLACEMENT_SCHEDULE',
  'OPEN_CALL',
  'DEVELOPMENT_TRACKS',
  'GENERAL_QUESTION',
  'SENIOR_STAFF',
  'OTHER',
  'UNKNOWN',
];

/**
 * Internal only. The structured shape the intent router returns.
 * Never rendered to the user — it exists so the application, not the prompt,
 * decides which workflow runs.
 */
export interface IntentDecision {
  intent: ChatbotIntent;
  confidence: number;
  extractedData: Record<string, unknown>;
  needsClarification: boolean;
}

/** Persisted per-WhatsApp-user conversation state. */
export interface ConversationState {
  id: string;
  accountId: string;
  phoneNumber: string;
  activeIntent: ChatbotIntent | null;
  activeWorkflow: string | null;
  /** Fields the active workflow has collected so far. */
  collectedData: Record<string, unknown>;
  /** Rolling summary + recent turns; NOT an unbounded transcript. */
  conversationContext: string;
  status: 'active' | 'completed' | 'escalated';
  lastMessageAt: string | null;
  createdAt: string;
}

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  createdAt?: string;
}

/** Result returned by every chatbot tool. */
export interface ToolResult {
  ok: boolean;
  /** Data handed back to the model. Never invented by the model itself. */
  data?: unknown;
  /** Human-readable failure reason, surfaced to the model so it can respond honestly. */
  error?: string;
  /** True when a lookup ran correctly but found nothing — distinct from a failure. */
  notFound?: boolean;
}

export type ToolExecutor = (
  input: Record<string, any>,
  ctx: WorkflowContext,
) => Promise<ToolResult> | ToolResult;

export interface ChatbotTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  execute: ToolExecutor;
}

/** Context handed to tools and workflows on every turn. */
export interface WorkflowContext {
  accountId: string;
  phoneNumber: string;
  conversation: ConversationState;
  config: ChatbotConfig;
  db: any;
  /** Sends a WhatsApp message via the existing WhatsAppManager. */
  sendWhatsApp: (to: string, message: string) => Promise<void>;
  /** Resolved "today" for relative-date parsing, injected for testability. */
  now: Date;
}

/**
 * A workflow bundles everything one capability needs. Adding a capability means
 * adding one of these to the registry — the engine itself does not change.
 */
export interface WorkflowDefinition {
  /** Stable id, also stored on the conversation row. */
  id: string;
  intent: ChatbotIntent;
  /** Hebrew label for the management UI. */
  label: string;
  /** Appended to the system prompt while this workflow is active. */
  instructions: string;
  /** Fields the workflow must collect before it can complete. */
  requiredFields?: Array<{ key: string; label: string }>;
  /** Tool names this workflow may call. */
  tools: string[];
  /**
   * Runs once every required field is present. Returns the message to send,
   * or null to let the model phrase the reply itself.
   */
  complete?: (
    data: Record<string, unknown>,
    ctx: WorkflowContext,
  ) => Promise<{ message: string | null; ok: boolean }>;
}

export interface ChatbotConfig {
  enabled: boolean;
  apiKey: string;
  model: string;
  /** Accounts the bot answers on. Empty = all connected accounts. */
  accountIds: string[];
  vehicleEntryStaffPhone: string;
  generalStaffPhone: string;
  openCallStaffPhone: string;
  /** Max turns kept verbatim before older ones are summarized away. */
  historyTurns: number;
  greeting: string;
  /** Rank -> staff member routing for senior-staff escalations. */
  seniorStaffRouting: Array<{ option: number; label: string; name: string; phone: string }>;
}

export interface KnowledgeSearchParams {
  query: string;
  category: KnowledgeCategory;
  filters?: Record<string, string>;
  limit?: number;
}

export type KnowledgeCategory =
  | 'general'
  | 'orders'
  | 'replacements'
  | 'development_tracks'
  | 'open_calls';

export interface KnowledgeEntry {
  id: string;
  category: KnowledgeCategory;
  title: string;
  content: string;
  /** JSON blob of category-specific fields (status, dates, audience…). */
  metadata: Record<string, unknown>;
  updatedAt: string;
}
