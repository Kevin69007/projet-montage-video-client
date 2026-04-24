"use client";

/**
 * Editor state — immutable updates via reducer.
 * Used by useEditorStore() in editor components.
 */

import { useCallback, useReducer } from "react";
import type {
  AppliedSubtitleStyle,
  EditorState,
  Marker,
  TranscriptEntry,
} from "./types";

type Action =
  | { type: "INIT"; state: EditorState }
  | { type: "UPDATE_STYLE"; style: AppliedSubtitleStyle }
  | { type: "TOGGLE_WORD_DELETED"; id: string }
  | { type: "DELETE_WORD_RANGE"; startId: string; endId: string }
  | { type: "RESTORE_WORD_RANGE"; startId: string; endId: string }
  | { type: "TOGGLE_LINE_BREAK"; id: string }
  | { type: "TRIM_SILENCE"; id: string; trimTo: number | null }
  | { type: "TOGGLE_SILENCE_DELETED"; id: string }
  | { type: "ADD_CUT"; time: number }
  | { type: "REMOVE_CUT"; time: number }
  | { type: "TOGGLE_SEGMENT_DELETED"; segId: string }
  | { type: "ADD_MARKER"; marker: Marker }
  | { type: "REMOVE_MARKER"; id: string }
  | { type: "RESOLVE_MARKER"; id: string };

function reducer(state: EditorState, action: Action): EditorState {
  const now = new Date().toISOString();
  switch (action.type) {
    case "INIT":
      return action.state;

    case "UPDATE_STYLE":
      return { ...state, style: action.style, updatedAt: now };

    case "TOGGLE_WORD_DELETED":
      return {
        ...state,
        transcription: state.transcription.map((e) =>
          e.id === action.id && e.type === "word"
            ? { ...e, deleted: !e.deleted }
            : e
        ),
        updatedAt: now,
      };

    case "DELETE_WORD_RANGE": {
      const { startId, endId } = action;
      const idxA = state.transcription.findIndex((e) => e.id === startId);
      const idxB = state.transcription.findIndex((e) => e.id === endId);
      if (idxA < 0 || idxB < 0) return state;
      const [lo, hi] = [Math.min(idxA, idxB), Math.max(idxA, idxB)];
      return {
        ...state,
        transcription: state.transcription.map((e, i) =>
          i >= lo && i <= hi && e.type === "word" ? { ...e, deleted: true } : e
        ),
        updatedAt: now,
      };
    }

    case "RESTORE_WORD_RANGE": {
      const { startId, endId } = action;
      const idxA = state.transcription.findIndex((e) => e.id === startId);
      const idxB = state.transcription.findIndex((e) => e.id === endId);
      if (idxA < 0 || idxB < 0) return state;
      const [lo, hi] = [Math.min(idxA, idxB), Math.max(idxA, idxB)];
      return {
        ...state,
        transcription: state.transcription.map((e, i) =>
          i >= lo && i <= hi && e.type === "word" ? { ...e, deleted: false } : e
        ),
        updatedAt: now,
      };
    }

    case "TOGGLE_LINE_BREAK":
      return {
        ...state,
        transcription: state.transcription.map((e) =>
          e.id === action.id && e.type === "word"
            ? { ...e, lineBreak: !e.lineBreak }
            : e
        ),
        updatedAt: now,
      };

    case "TRIM_SILENCE":
      return {
        ...state,
        transcription: state.transcription.map((e) =>
          e.id === action.id && e.type === "silence"
            ? { ...e, trimTo: action.trimTo }
            : e
        ),
        updatedAt: now,
      };

    case "TOGGLE_SILENCE_DELETED":
      return {
        ...state,
        transcription: state.transcription.map((e) =>
          e.id === action.id && e.type === "silence"
            ? { ...e, deleted: !e.deleted }
            : e
        ),
        updatedAt: now,
      };

    case "ADD_CUT": {
      // Insert cut sorted, dedupe
      const cuts = Array.from(new Set([...state.cuts, action.time])).sort(
        (a, b) => a - b
      );
      return { ...state, cuts, updatedAt: now };
    }

    case "REMOVE_CUT":
      return {
        ...state,
        cuts: state.cuts.filter((c) => c !== action.time),
        updatedAt: now,
      };

    case "TOGGLE_SEGMENT_DELETED": {
      const set = new Set(state.deletedSegments);
      if (set.has(action.segId)) set.delete(action.segId);
      else set.add(action.segId);
      return { ...state, deletedSegments: Array.from(set), updatedAt: now };
    }

    case "ADD_MARKER":
      return {
        ...state,
        markers: [...state.markers, action.marker],
        updatedAt: now,
      };

    case "REMOVE_MARKER":
      return {
        ...state,
        markers: state.markers.filter((m) => m.id !== action.id),
        updatedAt: now,
      };

    case "RESOLVE_MARKER":
      return {
        ...state,
        markers: state.markers.map((m) =>
          m.id === action.id ? { ...m, resolved: true } : m
        ),
        updatedAt: now,
      };

    default:
      return state;
  }
}

export function buildInitialState(
  transcription: TranscriptEntry[],
  style: AppliedSubtitleStyle
): EditorState {
  return {
    transcription,
    cuts: [],
    deletedSegments: [],
    markers: [],
    style,
    updatedAt: new Date().toISOString(),
  };
}

export function useEditorReducer(initial: EditorState) {
  const [state, dispatch] = useReducer(reducer, initial);

  // Memoized helpers
  const init = useCallback(
    (fullState: EditorState) => dispatch({ type: "INIT", state: fullState }),
    []
  );
  const updateStyle = useCallback(
    (style: AppliedSubtitleStyle) => dispatch({ type: "UPDATE_STYLE", style }),
    []
  );
  const toggleWordDeleted = useCallback(
    (id: string) => dispatch({ type: "TOGGLE_WORD_DELETED", id }),
    []
  );
  const deleteWordRange = useCallback(
    (startId: string, endId: string) =>
      dispatch({ type: "DELETE_WORD_RANGE", startId, endId }),
    []
  );
  const restoreWordRange = useCallback(
    (startId: string, endId: string) =>
      dispatch({ type: "RESTORE_WORD_RANGE", startId, endId }),
    []
  );
  const toggleLineBreak = useCallback(
    (id: string) => dispatch({ type: "TOGGLE_LINE_BREAK", id }),
    []
  );
  const trimSilence = useCallback(
    (id: string, trimTo: number | null) =>
      dispatch({ type: "TRIM_SILENCE", id, trimTo }),
    []
  );
  const toggleSilenceDeleted = useCallback(
    (id: string) => dispatch({ type: "TOGGLE_SILENCE_DELETED", id }),
    []
  );
  const addCut = useCallback(
    (time: number) => dispatch({ type: "ADD_CUT", time }),
    []
  );
  const removeCut = useCallback(
    (time: number) => dispatch({ type: "REMOVE_CUT", time }),
    []
  );
  const toggleSegmentDeleted = useCallback(
    (segId: string) => dispatch({ type: "TOGGLE_SEGMENT_DELETED", segId }),
    []
  );
  const addMarker = useCallback(
    (time: number, comment: string, author: Marker["author"] = "user") => {
      const marker: Marker = {
        id: `mk_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        time,
        comment,
        author,
        resolved: false,
        createdAt: new Date().toISOString(),
      };
      dispatch({ type: "ADD_MARKER", marker });
    },
    []
  );
  const removeMarker = useCallback(
    (id: string) => dispatch({ type: "REMOVE_MARKER", id }),
    []
  );
  const resolveMarker = useCallback(
    (id: string) => dispatch({ type: "RESOLVE_MARKER", id }),
    []
  );

  return {
    state,
    actions: {
      init,
      updateStyle,
      toggleWordDeleted,
      deleteWordRange,
      restoreWordRange,
      toggleLineBreak,
      trimSilence,
      toggleSilenceDeleted,
      addCut,
      removeCut,
      toggleSegmentDeleted,
      addMarker,
      removeMarker,
      resolveMarker,
    },
  };
}

/**
 * Compute kept segments from cuts + deletedSegments.
 * Returns array of {id, start, end, deleted} sorted by start time.
 */
export function computeSegments(
  cuts: number[],
  deletedSegments: string[],
  duration: number
): Array<{ id: string; start: number; end: number; deleted: boolean }> {
  if (duration <= 0) return [];
  const points = [0, ...cuts.filter((c) => c > 0 && c < duration), duration].sort(
    (a, b) => a - b
  );
  const dedup = points.filter((p, i) => i === 0 || p !== points[i - 1]);
  const segments = [];
  for (let i = 0; i < dedup.length - 1; i++) {
    const id = `seg_${i}`;
    segments.push({
      id,
      start: dedup[i],
      end: dedup[i + 1],
      deleted: deletedSegments.includes(id),
    });
  }
  return segments;
}
