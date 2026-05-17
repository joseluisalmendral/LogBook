/**
 * tui-providers-screen.test.ts — TDD RED tests for S1.4 ProvidersScreen.
 *
 * Tests cover:
 *   - reducer: providers screen list navigation wrapping
 *   - reducer: providers detail entry sets selectedProviderId
 *   - reducer: providers add wizard step transitions
 *   - reducer: providers test action triggers doing screen
 *   - reducer: providers remove triggers confirm modal state
 *   - reducer: confirm modal accept routes to doing screen (remove)
 *   - configure screen → providers screen routing (manage-providers select)
 *   - providers screen → back returns to configure
 *   - providers add wizard validates required fields
 *   - providers add wizard cancel returns to list
 *   - providers routing screen navigation
 *   - providers list wraps cursor at bottom
 *   - providers list wraps cursor at top
 *   - providers add wizard setField updates field
 *   - providers add wizard commit with all fields set
 *
 * All tests are pure — no I/O, no Ink imports.
 */

import { describe, it, expect } from "vitest";
import {
  initialState,
  reduce,
  CONFIGURE_MENU_LEN,
  CONFIGURE_ACTIONS,
  PROVIDERS_LIST_ACTIONS,
} from "../../src/tui/shell-flows.js";
import type {
  ShellSnapshot,
  ShellState,
  ShellAction,
} from "../../src/tui/types.js";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeSnapshot(overrides: Partial<ShellSnapshot> = {}): ShellSnapshot {
  return {
    projectRoot: "/tmp/test-project",
    installed: true,
    preset: "minimal",
    disabled: false,
    manifestSize: 5,
    tokenBreakdown: {
      skill: 0,
      augmentClaudemd: 0,
      mcpToolDescriptions: 0,
      slashCommandDescriptions: 0,
      subagentDescriptions: 0,
      statusline: 0,
      sessionStart: 0,
    },
    fixedContextTokens: 0,
    budget: 500,
    recentEvents: [],
    pendingReview: 0,
    adrCount: 0,
    lessonCount: 0,
    ...overrides,
  };
}

function makeConfigureState(cursor = 0): ShellState {
  return {
    snapshot: makeSnapshot(),
    screen: { kind: "configure", cursor },
  };
}

function makeProvidersListState(
  cursor = 0,
  providerCount = 3,
): ShellState {
  return {
    snapshot: makeSnapshot(),
    screen: {
      kind: "providers",
      view: "list",
      cursor,
      providerCount,
    },
  };
}

function makeProvidersDetailState(selectedProviderId: string): ShellState {
  return {
    snapshot: makeSnapshot(),
    screen: {
      kind: "providers",
      view: "detail",
      selectedProviderId,
      cursor: 0,
    },
  };
}

function makeProvidersAddState(
  step: 1 | 2 | 3 = 1,
  fields: Partial<{ kind: string; name: string; model: string; envVar: string }> = {},
): ShellState {
  return {
    snapshot: makeSnapshot(),
    screen: {
      kind: "providers",
      view: "add",
      step,
      fields: {
        kind: fields.kind ?? "",
        name: fields.name ?? "",
        model: fields.model ?? "",
        envVar: fields.envVar ?? "",
      },
      cursor: 0,
    },
  };
}

function makeProvidersRoutingState(): ShellState {
  return {
    snapshot: makeSnapshot(),
    screen: {
      kind: "providers",
      view: "routing",
      cursor: 0,
      routingCount: 2,
    },
  };
}

function dispatch(state: ShellState, action: ShellAction): ShellState {
  return reduce(state, action);
}

// ---------------------------------------------------------------------------
// configure screen → providers screen routing
// ---------------------------------------------------------------------------

describe("configure screen → providers screen routing", () => {
  it("selecting manage-providers from configure navigates to providers-list", () => {
    // Find the index of manage-providers in CONFIGURE_ACTIONS
    const idx = CONFIGURE_ACTIONS.indexOf("manage-providers");
    expect(idx).toBeGreaterThanOrEqual(0); // guard: action must exist
    const state = makeConfigureState(idx);
    const next = dispatch(state, { type: "select" });
    expect(next.screen.kind).toBe("providers");
    if (next.screen.kind === "providers") {
      expect(next.screen.view).toBe("list");
      expect(next.screen.cursor).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// providers screen list navigation
// ---------------------------------------------------------------------------

describe("reducer: providers screen list navigation", () => {
  it("navigate +1 increases cursor", () => {
    const state = makeProvidersListState(0, 3);
    const next = dispatch(state, { type: "navigate", delta: 1 });
    expect(next.screen.kind).toBe("providers");
    if (next.screen.kind === "providers" && next.screen.view === "list") {
      expect(next.screen.cursor).toBe(1);
    }
  });

  it("navigate -1 decreases cursor", () => {
    const state = makeProvidersListState(2, 3);
    const next = dispatch(state, { type: "navigate", delta: -1 });
    expect(next.screen.kind).toBe("providers");
    if (next.screen.kind === "providers" && next.screen.view === "list") {
      expect(next.screen.cursor).toBe(1);
    }
  });

  it("navigate -1 at 0 clamps to 0", () => {
    const state = makeProvidersListState(0, 3);
    const next = dispatch(state, { type: "navigate", delta: -1 });
    if (next.screen.kind === "providers" && next.screen.view === "list") {
      expect(next.screen.cursor).toBe(0);
    }
  });

  it("navigate +1 past last clamps at last", () => {
    const state = makeProvidersListState(2, 3); // cursor=2, count=3 (0,1,2)
    const next = dispatch(state, { type: "navigate", delta: 1 });
    if (next.screen.kind === "providers" && next.screen.view === "list") {
      expect(next.screen.cursor).toBe(2); // clamped
    }
  });
});

// ---------------------------------------------------------------------------
// providers detail entry sets selectedProviderId
// ---------------------------------------------------------------------------

describe("reducer: providers detail entry", () => {
  it("select from list navigates to detail with correct selectedProviderId", () => {
    const state = makeProvidersListState(0, 3);
    const next = dispatch(state, { type: "providers.list.select" });
    expect(next.screen.kind).toBe("providers");
    if (next.screen.kind === "providers") {
      expect(next.screen.view).toBe("detail");
      if (next.screen.view === "detail") {
        // selectedProviderId is the provider key at cursor 0
        expect(typeof next.screen.selectedProviderId).toBe("string");
        expect(next.screen.selectedProviderId.length).toBeGreaterThan(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// providers add wizard step transitions
// ---------------------------------------------------------------------------

describe("reducer: providers add wizard step transitions", () => {
  it("A key from list navigates to add wizard step 1", () => {
    const state = makeProvidersListState(0, 3);
    const next = dispatch(state, { type: "providers.add.start" });
    expect(next.screen.kind).toBe("providers");
    if (next.screen.kind === "providers") {
      expect(next.screen.view).toBe("add");
      if (next.screen.view === "add") {
        expect(next.screen.step).toBe(1);
      }
    }
  });

  it("wizard.next with kind set advances from step 1 to step 2", () => {
    const state = makeProvidersAddState(1, { kind: "anthropic" });
    const next = dispatch(state, { type: "providers.add.next" });
    if (next.screen.kind === "providers" && next.screen.view === "add") {
      expect(next.screen.step).toBe(2);
    }
  });

  it("wizard.next without kind does NOT advance from step 1", () => {
    const state = makeProvidersAddState(1, {}); // kind is empty
    const next = dispatch(state, { type: "providers.add.next" });
    if (next.screen.kind === "providers" && next.screen.view === "add") {
      expect(next.screen.step).toBe(1); // unchanged
    }
  });

  it("wizard.next on step 2 with name+model advances to step 3", () => {
    const state = makeProvidersAddState(2, { kind: "anthropic", name: "my-provider", model: "claude-sonnet-4-5" });
    const next = dispatch(state, { type: "providers.add.next" });
    if (next.screen.kind === "providers" && next.screen.view === "add") {
      expect(next.screen.step).toBe(3);
    }
  });

  it("wizard.next on step 2 without name does NOT advance", () => {
    const state = makeProvidersAddState(2, { kind: "anthropic", name: "", model: "claude-sonnet-4-5" });
    const next = dispatch(state, { type: "providers.add.next" });
    if (next.screen.kind === "providers" && next.screen.view === "add") {
      expect(next.screen.step).toBe(2); // unchanged
    }
  });

  it("wizard.next on step 2 without model does NOT advance", () => {
    const state = makeProvidersAddState(2, { kind: "anthropic", name: "my-provider", model: "" });
    const next = dispatch(state, { type: "providers.add.next" });
    if (next.screen.kind === "providers" && next.screen.view === "add") {
      expect(next.screen.step).toBe(2); // unchanged
    }
  });
});

// ---------------------------------------------------------------------------
// providers add wizard setField
// ---------------------------------------------------------------------------

describe("reducer: providers add wizard setField", () => {
  it("setField kind updates the kind field", () => {
    const state = makeProvidersAddState(1, {});
    const next = dispatch(state, { type: "providers.add.setField", field: "kind", value: "openai" });
    if (next.screen.kind === "providers" && next.screen.view === "add") {
      expect(next.screen.fields.kind).toBe("openai");
    }
  });

  it("setField name updates the name field", () => {
    const state = makeProvidersAddState(1, { kind: "anthropic" });
    const next = dispatch(state, { type: "providers.add.setField", field: "name", value: "my-openai" });
    if (next.screen.kind === "providers" && next.screen.view === "add") {
      expect(next.screen.fields.name).toBe("my-openai");
    }
  });

  it("setField envVar updates the envVar field", () => {
    const state = makeProvidersAddState(3, { kind: "anthropic", name: "p", model: "m" });
    const next = dispatch(state, { type: "providers.add.setField", field: "envVar", value: "MY_API_KEY" });
    if (next.screen.kind === "providers" && next.screen.view === "add") {
      expect(next.screen.fields.envVar).toBe("MY_API_KEY");
    }
  });
});

// ---------------------------------------------------------------------------
// providers add wizard cancel returns to list
// ---------------------------------------------------------------------------

describe("reducer: providers add wizard cancel", () => {
  it("providers.add.cancel from any step returns to list", () => {
    const state = makeProvidersAddState(2, { kind: "anthropic" });
    const next = dispatch(state, { type: "providers.add.cancel" });
    expect(next.screen.kind).toBe("providers");
    if (next.screen.kind === "providers") {
      expect(next.screen.view).toBe("list");
    }
  });
});

// ---------------------------------------------------------------------------
// providers add wizard commit (step 3 with envVar)
// ---------------------------------------------------------------------------

describe("reducer: providers add wizard commit", () => {
  it("providers.add.commit on step 3 with all fields triggers doing screen", () => {
    const state = makeProvidersAddState(3, {
      kind: "anthropic",
      name: "my-provider",
      model: "claude-sonnet-4-5",
      envVar: "MY_API_KEY",
    });
    const next = dispatch(state, { type: "providers.add.commit" });
    expect(next.screen.kind).toBe("doing");
    if (next.screen.kind === "doing") {
      expect(next.screen.promise).toBe("pending");
      expect(next.screen.returnTo).toBe("providers");
    }
  });

  it("providers.add.commit on step 3 without envVar does NOT advance", () => {
    const state = makeProvidersAddState(3, {
      kind: "anthropic",
      name: "my-provider",
      model: "claude-sonnet-4-5",
      envVar: "", // missing
    });
    const next = dispatch(state, { type: "providers.add.commit" });
    // Should stay on add screen
    expect(next.screen.kind).toBe("providers");
  });
});

// ---------------------------------------------------------------------------
// providers test action triggers doing screen
// ---------------------------------------------------------------------------

describe("reducer: providers test action", () => {
  it("providers.test.invoke transitions to doing screen", () => {
    const state = makeProvidersDetailState("my-provider");
    const next = dispatch(state, { type: "providers.test.invoke", providerId: "my-provider" });
    expect(next.screen.kind).toBe("doing");
    if (next.screen.kind === "doing") {
      expect(next.screen.promise).toBe("pending");
      expect(next.screen.returnTo).toBe("providers");
    }
  });
});

// ---------------------------------------------------------------------------
// providers remove triggers confirm modal state
// ---------------------------------------------------------------------------

describe("reducer: providers remove confirm", () => {
  it("providers.remove.request transitions to pendingRemove sub-state", () => {
    const state = makeProvidersDetailState("my-provider");
    const next = dispatch(state, { type: "providers.remove.request", providerId: "my-provider" });
    expect(next.screen.kind).toBe("providers");
    if (next.screen.kind === "providers") {
      expect(next.screen.view).toBe("confirm-remove");
      if (next.screen.view === "confirm-remove") {
        expect(next.screen.providerId).toBe("my-provider");
      }
    }
  });

  it("providers.remove.confirm (accepted) transitions to doing screen", () => {
    const state: ShellState = {
      snapshot: makeSnapshot(),
      screen: {
        kind: "providers",
        view: "confirm-remove",
        providerId: "my-provider",
        cursor: 0,
      },
    };
    const next = dispatch(state, { type: "providers.remove.confirm", confirmed: true });
    expect(next.screen.kind).toBe("doing");
    if (next.screen.kind === "doing") {
      expect(next.screen.promise).toBe("pending");
      expect(next.screen.returnTo).toBe("providers");
    }
  });

  it("providers.remove.confirm (rejected) returns to detail", () => {
    const state: ShellState = {
      snapshot: makeSnapshot(),
      screen: {
        kind: "providers",
        view: "confirm-remove",
        providerId: "my-provider",
        cursor: 0,
      },
    };
    const next = dispatch(state, { type: "providers.remove.confirm", confirmed: false });
    expect(next.screen.kind).toBe("providers");
    if (next.screen.kind === "providers") {
      expect(next.screen.view).toBe("detail");
    }
  });
});

// ---------------------------------------------------------------------------
// providers routing screen
// ---------------------------------------------------------------------------

describe("reducer: providers routing screen", () => {
  it("providers.list.routing from list navigates to routing view", () => {
    const state = makeProvidersListState(0, 3);
    const next = dispatch(state, { type: "providers.list.routing" });
    expect(next.screen.kind).toBe("providers");
    if (next.screen.kind === "providers") {
      expect(next.screen.view).toBe("routing");
    }
  });

  it("navigate on routing screen moves cursor", () => {
    const state = makeProvidersRoutingState();
    const next = dispatch(state, { type: "navigate", delta: 1 });
    if (next.screen.kind === "providers" && next.screen.view === "routing") {
      expect(next.screen.cursor).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// providers screen back navigation
// ---------------------------------------------------------------------------

describe("reducer: providers screen → back", () => {
  it("back from providers list returns to configure", () => {
    const state = makeProvidersListState(0, 3);
    const next = dispatch(state, { type: "back" });
    expect(next.screen.kind).toBe("configure");
  });

  it("back from providers detail returns to list", () => {
    const state = makeProvidersDetailState("my-provider");
    const next = dispatch(state, { type: "back" });
    expect(next.screen.kind).toBe("providers");
    if (next.screen.kind === "providers") {
      expect(next.screen.view).toBe("list");
    }
  });

  it("back from providers routing returns to list", () => {
    const state = makeProvidersRoutingState();
    const next = dispatch(state, { type: "back" });
    expect(next.screen.kind).toBe("providers");
    if (next.screen.kind === "providers") {
      expect(next.screen.view).toBe("list");
    }
  });

  it("back from providers add returns to list", () => {
    const state = makeProvidersAddState(2, { kind: "anthropic" });
    const next = dispatch(state, { type: "back" });
    expect(next.screen.kind).toBe("providers");
    if (next.screen.kind === "providers") {
      expect(next.screen.view).toBe("list");
    }
  });

  it("doing.dismiss returning to providers returns to providers list", () => {
    const state: ShellState = {
      snapshot: makeSnapshot(),
      screen: {
        kind: "doing",
        label: "Testing provider...",
        promise: "ok",
        returnTo: "providers",
      },
    };
    const next = dispatch(state, { type: "doing.dismiss" });
    expect(next.screen.kind).toBe("providers");
    if (next.screen.kind === "providers") {
      expect(next.screen.view).toBe("list");
    }
  });
});

// ---------------------------------------------------------------------------
// PROVIDERS_LIST_ACTIONS export
// ---------------------------------------------------------------------------

describe("PROVIDERS_LIST_ACTIONS export", () => {
  it("PROVIDERS_LIST_ACTIONS is exported and has at least 4 items", () => {
    expect(Array.isArray(PROVIDERS_LIST_ACTIONS)).toBe(true);
    expect(PROVIDERS_LIST_ACTIONS.length).toBeGreaterThanOrEqual(4);
  });
});
