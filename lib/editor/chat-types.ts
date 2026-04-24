/** Chat-related types for the editor's AI rework feature. */

import type { EditorState } from "./types";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  proposedState?: EditorState;   // Kimi may propose a new EditorState
  appliedAt?: string;            // ISO timestamp when user accepted
  createdAt: string;
}

export interface ChatRequest {
  state: EditorState;             // current editor state
  history: ChatMessage[];         // prior chat messages
  userMessage: string;            // new user comment
}

export interface ChatResponse {
  message: ChatMessage;           // assistant's reply (with proposedState if it modified anything)
  tokens?: {
    input: number;
    output: number;
    total: number;
    estimated_cost_usd: number;
  };
}
