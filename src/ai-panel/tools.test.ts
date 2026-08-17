// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mocks must be set up before importing the module under test.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("./permissions", () => ({ requestPermission: vi.fn().mockResolvedValue(true) }));
vi.mock("./modification-hub", () => ({ notifyDocumentChange: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { Schema } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { executeTool, parseToolCalls } from "./tools";

const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

// Minimal schema that matches the JSON shape produced by fromMarkdown
// (paragraph/heading carry pageBreakBefore; text carries marks).
function makeSchema(): Schema {
  return new Schema({
    nodes: {
      doc: { content: "block+" },
      paragraph: { group: "block", content: "text*", attrs: { pageBreakBefore: { default: false } }, toDOM: () => ["p", 0] },
      heading: { group: "block", content: "text*", attrs: { level: { default: 1 }, pageBreakBefore: { default: false } }, toDOM: (n) => ["h" + n.attrs.level, 0] },
      text: { group: "inline" },
    },
    marks: {
      strong: { toDOM: () => ["strong", 0] },
      em: { toDOM: () => ["em", 0] },
    },
  });
}

function makeView(initialText = "Hello world."): EditorView {
  const schema = makeSchema();
  const para = schema.nodes.paragraph.create(null, schema.text(initialText));
  const doc = schema.nodes.doc.create(null, para);
  const place = document.createElement("div");
  document.body.appendChild(place);
  return new EditorView(place, { state: EditorState.create({ doc, schema }) });
}

function docHasStrongMark(view: EditorView): boolean {
  let found = false;
  view.state.doc.nodesBetween(0, view.state.doc.content.size, (node) => {
    if (node.marks.some((m) => m.type.name === "strong")) found = true;
  });
  return found;
}

// ----------------------------------------------------------------------------
// Consolidation: every consolidated tool+action routes to the right command
// and returns the granular tool name (so chat.ts prefix dispatch keeps working).
// ----------------------------------------------------------------------------
describe("consolidated tool dispatch", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue("ok");
  });

  it("plan_manage create → plan_create, returns granular name", async () => {
    const r = await executeTool({ name: "plan_manage", arguments: { action: "create", name: "x", content: "status: active\n- [ ] t" } });
    expect(mockInvoke).toHaveBeenCalledWith("plan_create", { name: "x", content: "status: active\n- [ ] t" });
    expect(r.tool).toBe("plan_create");
  });

  it("plan_progress next → plan_next", async () => {
    const r = await executeTool({ name: "plan_progress", arguments: { action: "next", name: "x" } });
    expect(mockInvoke).toHaveBeenCalledWith("plan_next", { name: "x", answer: undefined });
    expect(r.tool).toBe("plan_next");
  });

  it("web_query search → web_search, returns granular name", async () => {
    const r = await executeTool({ name: "web_query", arguments: { action: "search", query: "cats", limit: 5 } });
    expect(mockInvoke).toHaveBeenCalledWith("web_search", { query: "cats", limit: 5 });
    expect(r.tool).toBe("web_search");
  });

  it("web_query fetch → web_fetch", async () => {
    const r = await executeTool({ name: "web_query", arguments: { action: "fetch", url: "http://x", format: "text" } });
    expect(mockInvoke).toHaveBeenCalledWith("web_fetch", { url: "http://x", format: "text" });
    expect(r.tool).toBe("web_fetch");
  });

  it("wiki_query read → wiki_read", async () => {
    const r = await executeTool({ name: "wiki_query", arguments: { action: "read", name: "page" } });
    expect(mockInvoke).toHaveBeenCalledWith("wiki_read", { name: "page" });
    expect(r.tool).toBe("wiki_read");
  });

  it("wiki_write page → wiki_write", async () => {
    const r = await executeTool({ name: "wiki_write", arguments: { action: "page", name: "p", content: "c" } });
    expect(mockInvoke).toHaveBeenCalledWith("wiki_write", { name: "p", content: "c", frontmatter: null });
    expect(r.tool).toBe("wiki_write");
  });

  it("file write → file_write", async () => {
    const r = await executeTool({ name: "file", arguments: { action: "write", path: "a.txt", content: "hi" } });
    expect(mockInvoke).toHaveBeenCalledWith("file_write", { path: "a.txt", content: "hi" });
    expect(r.tool).toBe("file_write");
  });

  it("rag add → rag_add (camelCase params)", async () => {
    const r = await executeTool({ name: "rag", arguments: { action: "add", project_id: "p", entity_type: "wiki", entity_id: "x", content_text: "c" } }, { ragEnabled: true });
    expect(mockInvoke).toHaveBeenCalledWith("rag_add", { projectId: "p", entityType: "wiki", entityId: "x", contentText: "c" });
    expect(r.tool).toBe("rag_add");
  });

  it("exec → exec with null optionals", async () => {
    const r = await executeTool({ name: "exec", arguments: { command: "echo hi" } }, { shellExecEnabled: true });
    expect(mockInvoke).toHaveBeenCalledWith("exec", { command: "echo hi", workdir: null, timeout: null, background: null, env: null });
    expect(r.tool).toBe("exec");
  });

  it("exec_job poll → exec_poll", async () => {
    const r = await executeTool({ name: "exec_job", arguments: { action: "poll", job_id: "j1", tail: 50 } }, { shellExecEnabled: true });
    expect(mockInvoke).toHaveBeenCalledWith("exec_poll", { jobId: "j1", tail: 50 });
    expect(r.tool).toBe("exec_poll");
  });

  it("document_query get_content → db_get_document", async () => {
    const r = await executeTool({ name: "document_query", arguments: { action: "get_content", project_id: "p", document_id: "d1" } });
    expect(mockInvoke).toHaveBeenCalledWith("db_get_document", { id: "d1" });
    expect(r.tool).toBe("get_document_content");
  });

  it("chat_history list_sessions → chat_list_recent_sessions", async () => {
    mockInvoke.mockResolvedValue([]);
    const r = await executeTool({ name: "chat_history", arguments: { action: "list_sessions", limit: 5 } });
    expect(mockInvoke).toHaveBeenCalledWith("chat_list_recent_sessions", { limit: 5 });
    expect(r.tool).toBe("chat_list_sessions");
  });

  it("unknown action returns an error, does not throw", async () => {
    const r = await executeTool({ name: "web_query", arguments: { action: "bogus" } });
    expect(r.error).toMatch(/Unknown web_query action/);
  });

  it("disabled web tool is refused", async () => {
    const r = await executeTool({ name: "web_query", arguments: { action: "search", query: "x" } }, { webSearchEnabled: false });
    expect(r.error).toMatch(/disabled/i);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("disabled exec_job is refused (not just exec)", async () => {
    const r = await executeTool({ name: "exec_job", arguments: { action: "list" } }, { shellExecEnabled: false });
    expect(r.error).toMatch(/disabled/i);
  });
});

// ----------------------------------------------------------------------------
// parseToolCalls still parses the consolidated tool names.
// ----------------------------------------------------------------------------
describe("parseToolCalls with consolidated tools", () => {
  it("parses an editor_edit call", () => {
    const calls = parseToolCalls('Sure. <tool name="editor_edit">{"action": "insert_at_end", "content": "Hi **there**."}</tool>');
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("editor_edit");
    expect(calls[0].arguments.action).toBe("insert_at_end");
    expect(calls[0].arguments.content).toBe("Hi **there**.");
  });

  it("parses multiple consolidated calls in one response", () => {
    const calls = parseToolCalls('<tool name="entity_query">{"action":"search","project_id":"p","query":"x"}</tool> text <tool name="plan_progress">{"action":"status","name":"y"}</tool>');
    expect(calls.map((c) => c.name)).toEqual(["entity_query", "plan_progress"]);
  });
});

// ----------------------------------------------------------------------------
// editor_edit executor: writes into a real ProseMirror document.
// ----------------------------------------------------------------------------
describe("editor_edit executor", () => {
  it("errors when no editor is provided", async () => {
    const r = await executeTool({ name: "editor_edit", arguments: { action: "insert_at_end", content: "x" } }, {});
    expect(r.error).toMatch(/No document is open/);
  });

  it("insert_at_end appends a new paragraph", async () => {
    const view = makeView("Hello world.");
    const r = await executeTool({ name: "editor_edit", arguments: { action: "insert_at_end", content: "New paragraph." } }, { editorView: view });
    expect(r.error).toBeUndefined();
    expect(view.state.doc.textContent).toContain("New paragraph.");
    // original text preserved
    expect(view.state.doc.textContent).toContain("Hello world.");
  });

  it("insert_at_cursor inserts at the caret", async () => {
    const view = makeView("Hello world.");
    // place caret in the middle (after "Hello", pos 6)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tr = view.state.tr.setSelection((view.state.selection.constructor as any).create(view.state.doc, 6));
    view.dispatch(tr);
    const r = await executeTool({ name: "editor_edit", arguments: { action: "insert_at_cursor", content: "[X]" } }, { editorView: view });
    expect(r.error).toBeUndefined();
    expect(view.state.doc.textContent).toContain("[X]");
  });

  it("insert_at_anchor places content after the exact anchor", async () => {
    const view = makeView("Hello world.");
    const r = await executeTool({ name: "editor_edit", arguments: { action: "insert_at_anchor", anchor: "world", position: "after", content: "!" } }, { editorView: view });
    expect(r.error).toBeUndefined();
    // The new "!" paragraph exists; order across blocks is preserved.
    expect(view.state.doc.textContent).toContain("!");
    expect(view.state.doc.textContent).toContain("Hello world.");
  });

  it("insert_at_anchor errors when the anchor is absent", async () => {
    const view = makeView("Hello world.");
    const r = await executeTool({ name: "editor_edit", arguments: { action: "insert_at_anchor", anchor: "MISSING", content: "x" } }, { editorView: view });
    expect(r.error).toMatch(/Anchor text not found/);
  });

  it("format applies bold (alias 'bold' → strong) to existing text", async () => {
    const view = makeView("Hello world.");
    const r = await executeTool({ name: "editor_edit", arguments: { action: "format", find: "world", mark: "bold" } }, { editorView: view });
    expect(r.error).toBeUndefined();
    expect(docHasStrongMark(view)).toBe(true);
    expect(view.state.doc.textContent).toBe("Hello world.");
  });

  it("format errors when mark is missing", async () => {
    const view = makeView("Hello world.");
    const r = await executeTool({ name: "editor_edit", arguments: { action: "format", find: "world" } }, { editorView: view });
    expect(r.error).toMatch(/requires 'mark'/);
  });

  it("delete removes the exact text", async () => {
    const view = makeView("Hello world.");
    const r = await executeTool({ name: "editor_edit", arguments: { action: "delete", find: "world" } }, { editorView: view });
    expect(r.error).toBeUndefined();
    expect(view.state.doc.textContent).not.toContain("world");
    expect(view.state.doc.textContent).toContain("Hello");
  });

  it("replace_document rewrites the whole document", async () => {
    const view = makeView("Hello world.");
    const r = await executeTool({ name: "editor_edit", arguments: { action: "replace_document", content: "# Title\n\nBrand new **bold** body." } }, { editorView: view });
    expect(r.error).toBeUndefined();
    expect(view.state.doc.textContent).toContain("Brand new bold body.");
    expect(view.state.doc.textContent).not.toContain("Hello world.");
    expect(docHasStrongMark(view)).toBe(true);
  });

  it("replace_selection replaces the live selection range", async () => {
    const view = makeView("Hello world.");
    // select "world"
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const TextSelection = view.state.selection.constructor as any;
    const doc = view.state.doc;
    const from = 1 + "Hello ".length; // pos of 'w'
    view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, from, from + "world".length)));
    const r = await executeTool(
      { name: "editor_edit", arguments: { action: "replace_selection", content: "everybody" } },
      { editorView: view, selection: { from, to: from + "world".length, text: "world" } },
    );
    expect(r.error).toBeUndefined();
    expect(view.state.doc.textContent).toContain("everybody");
    expect(view.state.doc.textContent).not.toContain("world");
  });

  it("replace_selection errors when nothing is selected", async () => {
    const view = makeView("Hello world.");
    const r = await executeTool(
      { name: "editor_edit", arguments: { action: "replace_selection", content: "x" } },
      { editorView: view },
    );
    expect(r.error).toMatch(/No text is selected/);
  });
});
