<!--
  TurnRow — base atomic row inside a ChapterPlayer.

  Dispatches `event.type` (legacy `manual.*` strings) or `event.kind` (new
  `agent_question` / `subagent_complete`) to the appropriate child component.

  Mapping:
    *.decision          → <DecisionMilestone>
    *.error             → <ErrorMarker>
    *.fix               → fix row (inline, no dedicated component yet)
    *.lesson            → lesson row (inline)
    *.milestone         → <MilestoneCard>
    *.resource          → <ResourceCard>
    agent_question      → <AgentQuestionCard>
    subagent_*          → <SubAgentCard>
    commit              → <CommitRow>
    DEFAULT             → minimal row with event.title

  Scroll-reveal animation:
    Spec motion #2 — opacity 0 → 1 + translateY(8px → 0) as the scrub
    progress crosses the row's offset. Gated by motionAllowed; reduced-motion
    shows the row fully visible at all times.
-->
<script lang="ts" module>
  /**
   * Module-scope set: dedupe "unknown kind" warnings across all TurnRow
   * instances in a session. R-86 / ADR-SN-D2 / NFR-4.
   *
   * Gated behind import.meta.env.DEV — production builds (the single-file
   * HTML opened by students) MUST be silent. The set lives at module scope so
   * the second TurnRow instance encountering the same unknown kind does not
   * re-warn.
   */
  const warnedKinds = new Set<string>();

  function warnOnceUnknownKind(k: string): void {
    if (typeof window === "undefined") return; // SSR safety
    if (!import.meta.env.DEV) return;
    if (warnedKinds.has(k)) return;
    warnedKinds.add(k);
    // eslint-disable-next-line no-console
    console.warn(`[narrative-rebuild] unknown event kind: ${k}`);
  }
</script>

<script lang="ts">
  import type { RenderEvent } from "../types";
  import { inspector } from "../stores/inspector";
  import DecisionMilestone from "./DecisionMilestone.svelte";
  import ErrorMarker from "./ErrorMarker.svelte";
  import MilestoneCard from "./MilestoneCard.svelte";
  import ResourceCard from "./ResourceCard.svelte";
  import AgentQuestionCard from "./AgentQuestionCard.svelte";
  import SubAgentCard from "./SubAgentCard.svelte";
  import CommitRow from "./CommitRow.svelte";
  import UserPromptRow from "./UserPromptRow.svelte";
  import ClaudeMessageRow from "./ClaudeMessageRow.svelte";
  import SessionContextRow from "./SessionContextRow.svelte";
  import MarkdownBlock from "./MarkdownBlock.svelte";
  import { payload } from "../stores/data";

  interface Props {
    event: RenderEvent;
  }

  const { event }: Props = $props();

  /**
   * Classification by event.type suffix or event.kind. Prefer kind when set
   * (new event shape from P2); fall back to type for legacy events.
   *
   * Slice-21 (ADR-SN-D2): explicit branches for `user_prompt` and
   * `claude_message`. The legacy "generic" / "Untitled event" fallback is
   * REMOVED — truly unknown kinds resolve to "unknown" and render NOTHING
   * (with a dev-only warn-once console message).
   */
  const kind = $derived.by(() => {
    const k = (event as { kind?: string }).kind ?? event.type ?? "";
    if (k === "user_prompt") return "user_prompt";
    if (k === "claude_message") return "claude_message";
    if (k === "session_context") return "session_context";
    if (k === "agent_question") return "agent_question";
    if (k.startsWith("subagent")) return "subagent";
    if (k.endsWith("decision")) return "decision";
    if (k.endsWith("error")) return "error";
    if (k.endsWith("fix")) return "fix";
    if (k.endsWith("lesson")) return "lesson";
    if (k.endsWith("milestone")) return "milestone";
    if (k.endsWith("resource")) return "resource";
    if (k === "commit") return "commit";
    return "unknown";
  });

  $effect(() => {
    if (kind === "unknown") {
      const k = (event as { kind?: string }).kind ?? event.type ?? "<no-kind>";
      warnOnceUnknownKind(k);
    }
  });

  const body = $derived(payload.bodies[event.id]);

  let selected = $state(false);

  function openInspector(): void {
    inspector.open(event.id);
  }

  // Track whether THIS row is the selected one in the inspector.
  import { onMount } from "svelte";
  import { selection } from "../stores/selection";
  import { router } from "../stores/router";
  onMount(() => {
    return inspector.subscribe((id) => {
      selected = id === event.id;
    });
  });

  function openInspectorWithSelection(): void {
    inspector.open(event.id);
    // Slice-12 P7 (R-68): emit selection + URL hash query for transcript sync.
    const route = router.get();
    if (route.name === "chapter") {
      selection._setFromRoute("chapter", event.id);
      router.navigate({ name: "chapter", chapterId: route.chapterId, eventId: event.id });
    }
  }
</script>

<div class="turn-row" data-testid="turn-row" data-kind={kind} class:is-selected={selected}>
  {#if kind === "agent_question"}
    <AgentQuestionCard {event} />
  {:else if kind === "user_prompt"}
    <UserPromptRow {event} />
  {:else if kind === "claude_message"}
    <ClaudeMessageRow {event} />
  {:else if kind === "session_context"}
    <SessionContextRow {event} />
  {:else if kind === "subagent"}
    <SubAgentCard {event} />
  {:else if kind === "decision"}
    <DecisionMilestone {event} />
  {:else if kind === "error"}
    <ErrorMarker {event} />
  {:else if kind === "milestone"}
    <MilestoneCard {event} />
  {:else if kind === "resource"}
    <ResourceCard {event} />
  {:else if kind === "commit"}
    <CommitRow {event} />
  {:else if kind === "lesson" || kind === "fix"}
    <!-- Lesson / fix — minimal row with click-to-inspect. -->
    <button
      type="button"
      class="generic-row lb-snap-target"
      data-kind-row={kind}
      data-interactive
      onclick={openInspectorWithSelection}
    >
      <span class="row-dot" aria-hidden="true"></span>
      <span class="row-eyebrow">{kind === "lesson" ? "Lesson" : "Fix"}</span>
      <span class="row-title">{event.title ?? (kind === "lesson" ? "Lesson" : "Fix")}</span>
    </button>
  {/if}
  <!-- Unknown kinds render nothing (R-86). The $effect above logs a dev-only
       warn-once message so we surface drift during development without
       polluting the production console. -->

  {#if body && kind !== "agent_question" && kind !== "subagent" && kind !== "user_prompt" && kind !== "claude_message" && kind !== "session_context" && kind !== "unknown"}
    <div class="body-slot">
      <MarkdownBlock {body} />
    </div>
  {/if}
</div>

<style>
  .turn-row {
    position: relative;
    transition: outline-color 200ms ease-out;
    border-radius: var(--card-radius);
  }

  .turn-row.is-selected {
    outline: 2px solid var(--color-accent-primary);
    outline-offset: 4px;
  }

  .body-slot {
    padding: 0 var(--p-space-4);
    margin: 0 0 var(--p-space-4) calc(22px + var(--p-space-3));
  }

  .generic-row {
    appearance: none;
    background: transparent;
    border: 0;
    width: 100%;
    text-align: left;
    cursor: pointer;
    font: inherit;
    color: inherit;
    display: flex;
    align-items: center;
    gap: var(--p-space-3);
    padding: var(--p-space-3) var(--p-space-4);
    margin: var(--p-space-1) 0;
    border-left: 2px solid transparent;
    border-radius: var(--radius-sm);
    transition: background 150ms ease, border-color 150ms ease;
  }

  .generic-row[data-kind-row="lesson"] {
    border-left-color: var(--color-accent-secondary);
  }
  .generic-row[data-kind-row="fix"] {
    border-left-color: var(--color-success);
  }

  .generic-row:hover {
    background: var(--color-surface-raised);
  }

  .row-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--color-text-tertiary);
    flex-shrink: 0;
  }

  .generic-row[data-kind-row="lesson"] .row-dot { background: var(--color-accent-secondary); }
  .generic-row[data-kind-row="fix"] .row-dot { background: var(--color-success); }

  .row-eyebrow {
    font-size: var(--font-size-caption);
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    flex-shrink: 0;
    font-weight: 600;
  }

  .generic-row[data-kind-row="lesson"] .row-eyebrow { color: var(--color-accent-secondary); }
  .generic-row[data-kind-row="fix"] .row-eyebrow { color: var(--color-success); }

  .row-title {
    color: var(--color-text-primary);
    font-size: var(--font-size-body);
    flex: 1;
    line-height: 1.4;
  }
</style>
