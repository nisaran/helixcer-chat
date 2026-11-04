import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
const app = await readFile(new URL("./app.js", import.meta.url), "utf8");
function extract(name) {
  const start = app.indexOf("  function " + name + "(");
  const end = app.indexOf("\n  function ", start + 1);
  return app.slice(start, end);
}
test("campaign audience waits for a channel and uses platform IDs across channels", () => {
  const contacts = [
    { contactId: "other-channel", platformIds: { whatsapp: "123", telegram: "456" } },
    { contactId: "telegram-only", platformIds: { telegram: "789" } },
    { contactId: "no-profile", platformIds: {} },
  ];
  let channel = null;
  const context = vm.createContext({
    state: { campaigns: { contactFilters: {} } },
    selectedCampaignChannel: () => channel,
    connectorPlatform: type => type === "whatsapp_cloud" ? "whatsapp" : type,
    filteredCampaignContacts: () => contacts,
    contactPlatformIds: contact => contact.platformIds,
    campaignContactPlatformRows: contact => Object.entries(contact.platformIds).map(([platform, profileId]) => ({ contact, platform, profileId })),
  });
  vm.runInContext(extract("filteredCampaignContactRows"), context);
  const rows = () => vm.runInContext("filteredCampaignContactRows()", context);
  assert.equal(rows().length, 0);
  channel = { channelId: "selected-channel", connectorType: "whatsapp_cloud" };
  assert.equal(rows().length, 1);
  assert.equal(rows()[0].contact.contactId, "other-channel");
  assert.equal(rows()[0].profileId, "123");
  channel = { connectorType: "telegram" };
  assert.equal(rows().length, 2);
  context.state.campaigns.contactFilters.platforms = new Set(["whatsapp"]);
  assert.equal(rows().length, 0);
});
