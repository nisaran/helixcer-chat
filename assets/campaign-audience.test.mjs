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

test("full campaign details show saved filters, escape content, and label legacy data", () => {
  const context = vm.createContext({
    campaignHistoryChannelInfo: () => ({ name: "Current channel", identifier: "123" }),
    campaignHistoryPlatform: () => "whatsapp",
    campaignPlatformLabel: value => value,
    campaignStatusLabel: value => value,
    formatCampaignTime: value => value,
    escapeHtml: value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
  });
  vm.runInContext(extract("campaignCurrentSentCount") + extract("campaignFullDetailsMarkup"), context);
  context.campaign = { name: "<script>", fieldMapping: { __campaignDetails: { platform: "whatsapp", channelName: "Original channel", filters: ["Company: Acme", "Tags: Reminder"] } } };
  let markup = vm.runInContext("campaignFullDetailsMarkup(campaign)", context);
  assert.ok(markup.includes("Company: Acme · Tags: Reminder"));
  assert.ok(markup.includes("Original channel"));
  assert.ok(markup.includes("&lt;script&gt;"));
  assert.ok(!markup.includes("<script>"));
  context.campaign = { variableMapping: { variableMappings: [{ id: "body_1", source: "contact.displayName" }], textVariables: [{ key: "company", value: "Acme" }], previewText: "Hello customer", mediaPreview: { filename: "notice.pdf" } } };
  markup = vm.runInContext("campaignFullDetailsMarkup(campaign)", context);
  assert.ok(markup.includes("body_1"));
  assert.ok(markup.includes("Acme"));
  assert.ok(markup.includes("Hello customer"));
  assert.ok(markup.includes("notice.pdf"));
  context.campaign = { variableMapping: [{ id: "legacy", value: "Legacy value" }] };
  markup = vm.runInContext("campaignFullDetailsMarkup(campaign)", context);
  assert.ok(markup.includes("Legacy value"));
  context.campaign = {};
  markup = vm.runInContext("campaignFullDetailsMarkup(campaign)", context);
  assert.ok(markup.includes("Not recorded for this campaign"));
  context.campaign = { audienceSource: "upload", fieldMapping: { profileId: "Phone", __campaignDetails: { filters: [] } } };
  markup = vm.runInContext("campaignFullDetailsMarkup(campaign)", context);
  assert.ok(markup.includes("Not applicable (uploaded contacts)"));
  assert.ok(markup.includes("Phone"));
  assert.ok(!markup.includes("CSV column: __campaignDetails"));
});

test("campaign reset clears draft inputs, recipients, upload mappings, and filters", () => {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { value: "old input", hidden: false, reset() {}, replaceChildren() {}, setAttribute() {} });
    return nodes.get(id);
  };
  node("campaignName"); node("campaignChannel"); node("campaignMessageText");
  const campaigns = { audienceSource: "upload", uploadRows: [{ Phone: "123" }], templateKey: "old", selectedContactIds: new Set(["old"]), audienceContactIds: new Set(["old"]), contactFilters: { companies: new Set(["Acme"]) } };
  let renders = 0;
  const context = vm.createContext({
    state: { campaigns }, $: node,
    closeCampaignChannelMenu() {},
    clearCampaignContactFilters() { campaigns.contactFilters = {}; campaigns.contactFilter = ""; },
    renderCampaignCreateForm() { renders++; },
  });
  vm.runInContext(extract("resetCampaignCreateForm"), context);
  vm.runInContext("resetCampaignCreateForm()", context);
  assert.equal(node("campaignName").value, "");
  assert.equal(node("campaignChannel").value, "");
  assert.equal(node("campaignMessageText").value, "");
  assert.equal(campaigns.audienceSource, "contacts");
  assert.equal(campaigns.uploadRows.length, 0);
  assert.equal(campaigns.templateKey, "");
  assert.equal(campaigns.selectedContactIds.size, 0);
  assert.equal(campaigns.audienceContactIds.size, 0);
  assert.deepEqual(campaigns.contactFilters, {});
  assert.equal(renders, 1);
});

test("sent count excludes messages that advanced to delivered or read", () => {
  const context = vm.createContext({});
  vm.runInContext(extract("campaignCurrentSentCount"), context);
  for (const [sentCount, deliveredCount, expected] of [[10,4,6],[10,10,0],[0,0,0],[2,3,0]]) {
    context.campaign = { sentCount, deliveredCount };
    assert.equal(vm.runInContext("campaignCurrentSentCount(campaign)",context),expected);
  }
});
