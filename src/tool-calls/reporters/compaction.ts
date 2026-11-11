import type { SessionNotification } from "@agentclientprotocol/sdk/unstable";
import {
  type ContextCompactionMetadata,
  createContextCompactionMeta,
} from "../../context-compaction-meta.js";
import { textContent } from "../content.js";

type CompactionFacts = Omit<ContextCompactionMetadata, "version">;
type ToolCallUpdate = SessionNotification["update"];

const TITLE = "Compact conversation";

/** The note a settled (never finished) compaction carries as its result. */
const SETTLED_NOTE =
  "Context compaction was cancelled before it finished; the conversation was not summarized.";

/** The human-readable result of a compaction, for clients that show `content`. */
function factsText(facts: CompactionFacts): string {
  // Widened to `string`: upstream added the `idle` trigger after this release,
  // and a comparison against it must not be a type error here or after the
  // next rebase.
  const trigger: string | undefined = facts.trigger;
  const what =
    trigger === "idle"
      ? "Context compacted while idle"
      : trigger === "manual"
        ? "Context compacted on request"
        : "Context compacted";
  const details: string[] = [];
  if (typeof facts.preTokens === "number" && typeof facts.postTokens === "number") {
    details.push(`${facts.preTokens} -> ${facts.postTokens} tokens`);
  } else if (typeof facts.postTokens === "number") {
    details.push(`${facts.postTokens} tokens after compaction`);
  }
  if (typeof facts.durationMs === "number") {
    details.push(`${(facts.durationMs / 1000).toFixed(1)}s`);
  }
  return details.length > 0 ? `${what}: ${details.join(", ")}` : what;
}

/**
 * The synthetic "Compact conversation" tool call, for a client without the
 * ACP compaction updates.
 *
 * AIR detects it by `_meta.jetbrains.air.contextCompaction`, which holds the
 * trigger, the token counts, the duration, and the error. The error also goes
 * to `content` once, because it is the result to show. No `rawOutput` repeats
 * the facts for AIR.
 *
 * Every other client gets the upstream fields: the tool name `compact`, and
 * the facts in `rawOutput`. It gets no AIR key.
 */
export const compactionToolCall = {
  started(compactionId: string, airClient = false): ToolCallUpdate {
    return {
      sessionUpdate: "tool_call",
      toolCallId: compactionId,
      title: TITLE,
      kind: "think",
      status: "in_progress",
      _meta: meta({}, airClient),
    };
  },

  inProgress(compactionId: string, airClient = false): ToolCallUpdate {
    return {
      sessionUpdate: "tool_call_update",
      toolCallId: compactionId,
      status: "in_progress",
      _meta: meta({}, airClient),
    };
  },

  /**
   * Settle a compaction that was abandoned at a turn boundary, so the call
   * does not stay `in_progress` forever.
   *
   * ACP v1's `ToolCallStatus` has no `cancelled` value, so this closes as
   * `completed` and says what actually happened in `content`. Clients that
   * treat a call without a terminal status as unclosed would otherwise resend
   * it later, out of order.
   */
  settled(compactionId: string, note = SETTLED_NOTE, airClient = false): ToolCallUpdate {
    return {
      sessionUpdate: "tool_call_update",
      toolCallId: compactionId,
      status: "completed",
      content: [textContent(note)],
      _meta: meta({}, airClient),
    };
  },

  /** The terminal report. A missed opening makes it the first report, a `tool_call`. */
  finished(
    compactionId: string,
    status: "completed" | "failed" | undefined,
    facts: CompactionFacts,
    first: boolean,
    airClient = false,
  ): ToolCallUpdate {
    const errorContent =
      status === "failed" && facts.error
        ? { content: [textContent(`Compaction failed: ${facts.error}`)] }
        : {};
    // A client that renders `content` needs something to expand; `rawOutput`
    // alone is opaque. The error, when there is one, is the result instead.
    // AIR reads every fact from `_meta.jetbrains.air.contextCompaction`, so it
    // gets no `content`: the docs ask for each fact once.
    const factsContent =
      airClient || "content" in errorContent || Object.keys(facts).length === 0
        ? {}
        : { content: [textContent(factsText(facts))] };
    const rawOutput = !airClient && Object.keys(facts).length > 0 ? { rawOutput: facts } : {};
    if (first) {
      return {
        sessionUpdate: "tool_call",
        toolCallId: compactionId,
        title: TITLE,
        kind: "think",
        status: status ?? "completed",
        ...errorContent,
        ...factsContent,
        ...rawOutput,
        _meta: meta(facts, airClient),
      };
    }
    return {
      sessionUpdate: "tool_call_update",
      toolCallId: compactionId,
      ...(status ? { status } : {}),
      ...errorContent,
      ...factsContent,
      ...rawOutput,
      _meta: meta(facts, airClient),
    };
  },
};

/** The compaction facts for AIR, and the upstream tool name for every other client. */
function meta(facts: CompactionFacts, airClient: boolean): Record<string, unknown> {
  return airClient ? createContextCompactionMeta(facts) : { claudeCode: { toolName: "compact" } };
}
