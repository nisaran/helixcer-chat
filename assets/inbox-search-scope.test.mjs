import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
const app = await readFile(new URL("./app.js", import.meta.url), "utf8");
const start = app.indexOf("  function filteredConversations() {");
const end = app.indexOf("  function unifiedConversations()", start);
test("global search bypasses status filters and clearing restores them", () => {
  let permission = "all";
  const items = [
    { conversationId: "open", status: "open", assigned: true, unreadCount: 1, lastMessageAt: "2026-11-04" },
    { conversationId: "closed", status: "closed", assigned: false, unreadCount: 0, lastMessageAt: "2026-11-03" },
    {
      conversationId: "campaign-closed",
      status: "closed",
      assigned: true,
      unreadCount: 0,
      lastMessageAt: "2026-11-05",
      lastMessageType: "template",
    },
  ];
  const state = { filters: new Set(["open"]), search: "Ada" };
  const context = vm.createContext({ state, chatPermissionScope: () => permission,
    unifiedConversations: () => items, isAssignedToCurrentUser: item => item.assigned,
    isAllConversationFilters: selected => selected.size === 4 });
  vm.runInContext(app.slice(start, end), context);
  const ids = () => Array.from(vm.runInContext("filteredConversations()", context), item => item.conversationId);
  assert.deepEqual(ids(), ["campaign-closed", "open", "closed"]);
  state.search = "";
  assert.deepEqual(ids(), ["campaign-closed", "open"]);
  assert.deepEqual([...state.filters], ["open"]);
  state.filters = new Set(["closed"]);
  assert.deepEqual(ids(), ["campaign-closed", "closed"]);
  state.filters = new Set(["open"]);
  state.search = "Ada";
  permission = "assigned";
  assert.deepEqual(ids(), ["campaign-closed", "open"]);
  permission = "none";
  assert.deepEqual(ids(), []);
});
