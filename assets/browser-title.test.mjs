import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
const app = await readFile(new URL("./app.js", import.meta.url), "utf8");
const start = app.indexOf("  function updateBrowserTitle(");
const end = app.indexOf("  function updateWorkspaceIdentity(", start);
test("browser titles include the current page and workspace and update after renaming", () => {
  const document = {};
  const state = { workspace: { name: "Helixcer" } };
  const context = vm.createContext({ document, state, DEFAULT_WORKSPACE: "Helixcer workspace", $: () => ({ textContent: "Inbox" }) });
  vm.runInContext(app.slice(start, end), context);
  vm.runInContext("updateBrowserTitle()", context);
  assert.equal(document.title, "Inbox | Helixcer | Helixcer Chat");
  for (const page of ["Contacts", "Campaign", "Channels", "WhatsApp Templates", "Import Chat", "Developer API", "Team", "Roles", "Workspace", "Settings"]) {
    context.page = page;
    vm.runInContext("updateBrowserTitle(page)", context);
    assert.equal(document.title, page + " | Helixcer | Helixcer Chat");
  }
  state.workspace.displayName = "Renamed workspace";
  vm.runInContext("updateBrowserTitle()", context);
  assert.equal(document.title, "Inbox | Renamed workspace | Helixcer Chat");
});
