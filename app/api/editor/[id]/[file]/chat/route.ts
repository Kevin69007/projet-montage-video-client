import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import {
  buildEditorReworkSystem,
  buildEditorReworkUserMessage,
} from "@/prompts.mjs";
import type { EditorState } from "@/lib/editor/types";
import type { ChatMessage } from "@/lib/editor/chat-types";

export const runtime = "nodejs";
export const maxDuration = 120;

const KIMI_API_URL = "https://api.moonshot.ai/v1/chat/completions";
const KIMI_MODEL = process.env.KIMI_MODEL || "kimi-k2.6";
const MAX_TOKENS = 6000;

interface KimiChanges {
  deletedWordIds?: string[];
  restoredWordIds?: string[];
  deletedSilenceIds?: string[];
  trimSilences?: Array<{ id: string; trimTo: number | null }>;
  lineBreakToggles?: string[];
  addCuts?: number[];
  removeCuts?: number[];
  toggleSegmentDeletes?: string[];
  style?: {
    name?: string;
    accentColor?: string;
    sizeOverride?: number | null;
    posY?: number;
    wpl?: number;
    lines?: number;
  };
}

interface KimiOutput {
  reply: string;
  changes?: KimiChanges;
}

/** Apply Kimi's proposed changes to an EditorState, return new state. */
function applyChanges(state: EditorState, changes: KimiChanges): EditorState {
  const next: EditorState = {
    ...state,
    transcription: state.transcription.map((e) => ({ ...e })),
    cuts: [...state.cuts],
    deletedSegments: [...state.deletedSegments],
    markers: [...state.markers],
    style: { ...state.style },
    updatedAt: new Date().toISOString(),
  };

  // Word deletions / restorations
  const deletedSet = new Set(changes.deletedWordIds || []);
  const restoredSet = new Set(changes.restoredWordIds || []);
  const lineBreakSet = new Set(changes.lineBreakToggles || []);
  const deletedSilenceSet = new Set(changes.deletedSilenceIds || []);

  next.transcription = next.transcription.map((e) => {
    if (e.type === "word") {
      if (deletedSet.has(e.id)) return { ...e, deleted: true };
      if (restoredSet.has(e.id)) return { ...e, deleted: false };
      if (lineBreakSet.has(e.id)) return { ...e, lineBreak: !e.lineBreak };
    } else if (e.type === "silence") {
      if (deletedSilenceSet.has(e.id)) return { ...e, deleted: true };
      const trim = changes.trimSilences?.find((t) => t.id === e.id);
      if (trim) return { ...e, trimTo: trim.trimTo };
    }
    return e;
  });

  // Cuts
  if (changes.addCuts) {
    for (const t of changes.addCuts) {
      if (!next.cuts.includes(t)) next.cuts.push(t);
    }
    next.cuts.sort((a, b) => a - b);
  }
  if (changes.removeCuts) {
    next.cuts = next.cuts.filter((c) => !changes.removeCuts!.includes(c));
  }

  // Segment deletes
  if (changes.toggleSegmentDeletes) {
    const set = new Set(next.deletedSegments);
    for (const id of changes.toggleSegmentDeletes) {
      if (set.has(id)) set.delete(id);
      else set.add(id);
    }
    next.deletedSegments = Array.from(set);
  }

  // Style
  if (changes.style) {
    next.style = {
      ...next.style,
      ...(changes.style.accentColor !== undefined ? { accentColor: changes.style.accentColor } : {}),
      ...(changes.style.sizeOverride !== undefined ? { sizeOverride: changes.style.sizeOverride } : {}),
      ...(changes.style.posY !== undefined ? { posY: changes.style.posY } : {}),
      ...(changes.style.wpl !== undefined ? { wpl: changes.style.wpl } : {}),
      ...(changes.style.lines !== undefined ? { lines: changes.style.lines } : {}),
    };
  }

  return next;
}

/** Strip markdown code fences if Kimi wraps the JSON. */
function extractJson(text: string): KimiOutput | null {
  let s = text.trim();
  // Remove ```json ... ``` fences
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(s);
  } catch {
    // Try to find a JSON object inside the text
    const m = s.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; file: string }> }
) {
  try {
    const { id, file } = await params;
    const decodedFile = decodeURIComponent(file);

    if (!process.env.KIMI_API_KEY) {
      return NextResponse.json(
        { error: "KIMI_API_KEY non configuree" },
        { status: 500 }
      );
    }

    const body = await req.json();
    const state = body.state as EditorState | undefined;
    const userMessage = body.userMessage as string | undefined;
    const history = (body.history as ChatMessage[] | undefined) || [];

    if (!state || !userMessage) {
      return NextResponse.json(
        { error: "Missing state or userMessage" },
        { status: 400 }
      );
    }

    const cwd = /*turbopackIgnore: true*/ process.cwd();
    let stylesJson = "{}";
    try {
      stylesJson = fs.readFileSync(path.join(cwd, "pipeline", "styles.json"), "utf-8");
    } catch {}

    const systemPrompt = buildEditorReworkSystem({ stylesJson });
    const userPrompt = buildEditorReworkUserMessage({ state, userMessage });

    // Build messages array — include compressed history (last 6 turns max)
    const messages: Array<{ role: string; content: string }> = [
      { role: "system", content: systemPrompt },
    ];
    const recentHistory = history.slice(-6);
    for (const m of recentHistory) {
      messages.push({ role: m.role, content: m.content });
    }
    messages.push({ role: "user", content: userPrompt });

    // Call Kimi with JSON mode
    const res = await fetch(KIMI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.KIMI_API_KEY}`,
      },
      body: JSON.stringify({
        model: KIMI_MODEL,
        messages,
        temperature: 1,
        max_tokens: MAX_TOKENS,
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json(
        { error: `Kimi API error ${res.status}: ${errText.slice(0, 300)}` },
        { status: 502 }
      );
    }

    const data = await res.json();
    const rawContent = data.choices?.[0]?.message?.content || "";
    const parsed = extractJson(rawContent);

    if (!parsed) {
      return NextResponse.json(
        { error: `Kimi reponse invalide (pas de JSON): ${rawContent.slice(0, 200)}` },
        { status: 502 }
      );
    }

    const reply = typeof parsed.reply === "string" ? parsed.reply : "(pas de reponse)";
    let proposedState: EditorState | undefined;
    if (parsed.changes && Object.keys(parsed.changes).length > 0) {
      proposedState = applyChanges(state, parsed.changes);
    }

    const message: ChatMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      role: "assistant",
      content: reply,
      proposedState,
      createdAt: new Date().toISOString(),
    };

    // Save chat history alongside edits (jobs/{id}/chats/{file}.json)
    try {
      const chatDir = path.join(cwd, "jobs", id, "chats");
      fs.mkdirSync(chatDir, { recursive: true });
      const chatPath = path.join(chatDir, `${decodedFile}.json`);
      let prior: ChatMessage[] = [];
      if (fs.existsSync(chatPath)) {
        try { prior = JSON.parse(fs.readFileSync(chatPath, "utf-8")); } catch {}
      }
      const userMsg: ChatMessage = {
        id: `msg_${Date.now() - 1}_${Math.random().toString(36).slice(2, 7)}`,
        role: "user",
        content: userMessage,
        createdAt: new Date(Date.now() - 1).toISOString(),
      };
      const updated = [...prior, userMsg, message];
      fs.writeFileSync(chatPath, JSON.stringify(updated, null, 2));
    } catch (e) {
      console.error("Failed to persist chat history:", e);
    }

    return NextResponse.json({
      message,
      tokens: data.usage
        ? {
            input: data.usage.prompt_tokens || 0,
            output: data.usage.completion_tokens || 0,
            total: data.usage.total_tokens || 0,
            estimated_cost_usd: 0,
          }
        : undefined,
    });
  } catch (err: unknown) {
    const error = err as Error;
    console.error("[EDITOR CHAT] Error:", error);
    return NextResponse.json(
      { error: error.message || "Chat failed" },
      { status: 500 }
    );
  }
}

