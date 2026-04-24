"use client";

import { useState } from "react";
import type { ChatMessage } from "@/lib/editor/chat-types";

interface ChatPanelProps {
  messages: ChatMessage[];
  isPending: boolean;
  onSend: (message: string) => Promise<void>;
  onAcceptProposal: (msg: ChatMessage) => void;
  onRejectProposal: (msg: ChatMessage) => void;
}

export default function ChatPanel({
  messages,
  isPending,
  onSend,
  onAcceptProposal,
  onRejectProposal,
}: ChatPanelProps) {
  const [draft, setDraft] = useState("");

  const submit = async () => {
    const text = draft.trim();
    if (!text || isPending) return;
    setDraft("");
    await onSend(text);
  };

  return (
    <div className="glass-card p-4 space-y-3">
      <div className="mono-label">Chat IA — Demander a Kimi</div>

      <div className="space-y-2 max-h-72 overflow-y-auto">
        {messages.length === 0 ? (
          <p className="text-xs text-text-muted italic">
            Demande des modifications en langage naturel. Exemple : &laquo;supprime le &lsquo;euh&rsquo; vers 0:12&raquo;, &laquo;coupe la pause au debut&raquo;, &laquo;mets le texte plus gros&raquo;.
          </p>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={`p-2 border text-xs ${
                m.role === "user"
                  ? "border-orange/30 bg-orange/5 text-text-body"
                  : "border-purple/30 bg-purple/5 text-text-body"
              }`}
            >
              <div className="mono-label text-[9px] mb-1">
                {m.role === "user" ? "Toi" : "Kimi"}
                {m.appliedAt && <span className="text-purple-light"> — applique</span>}
              </div>
              <p className="whitespace-pre-wrap break-words">{m.content}</p>

              {m.role === "assistant" && m.proposedState && !m.appliedAt && (
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => onAcceptProposal(m)}
                    className="btn-primary text-[10px] py-1 px-2"
                  >
                    ✓ Appliquer
                  </button>
                  <button
                    onClick={() => onRejectProposal(m)}
                    className="btn-ghost text-[10px] py-1 px-2"
                  >
                    ✕ Ignorer
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <div className="flex gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Decris ce que tu veux changer..."
          className="glass-input flex-1 text-xs min-h-[60px] resize-y"
          disabled={isPending}
        />
        <button
          onClick={submit}
          disabled={isPending || !draft.trim()}
          className="btn-primary text-xs px-3 self-start disabled:opacity-50"
        >
          {isPending ? "..." : "Envoyer"}
        </button>
      </div>
      <p className="text-[10px] text-text-muted opacity-60">Cmd/Ctrl + Enter pour envoyer</p>
    </div>
  );
}
