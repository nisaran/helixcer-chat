(() => {
  const API_BASE = "https://api.chat.helixcer.com";
  const STORAGE_KEY = "hxc.tally.createConfig.v1";
  const CONN_KEY = "hxc.tally.connection.v1";

  const VOUCHER_FIELDS = [
    "Not Applicable",
    "Voucher Number",
    "Voucher Date",
    "Amount",
    "Reference",
    "Narration",
    "Party Name",
    "Party Mobile",
    "Party Email",
    "Company Name",
    "Guid",
  ];

  const VOUCHER_TYPES = [
    "Sales",
    "Purchase",
    "Credit Note",
    "Debit Note",
    "Receipt",
    "Payment",
    "Journal",
    "Contra",
    "Delivery Note",
    "Inventory Sales",
  ];

  /** Sample templates so the UI works without live API / CORS. */
  const SAMPLES = {
    sales_invoice_v2: {
      name: "sales_invoice_v2",
      language: "en",
      previewText: "Hello {{customer_name}}, your invoice {{invoice_number}} is ready.",
      headerKind: "media",
      headerFormat: "DOCUMENT",
      headerKey: "",
      variables: [
        { component: "body", key: "customer_name" },
        { component: "body", key: "invoice_number" },
      ],
    },
    travel_ticket_confirm: {
      name: "travel_ticket_confirm",
      language: "en",
      previewText:
        "Hi {{passenger_name}}, your ticket {{pnr}} for {{route}} on {{travel_date}} is confirmed.",
      headerKind: "text",
      headerFormat: "TEXT",
      headerKey: "1",
      variables: [
        { component: "header", key: "1" },
        { component: "body", key: "passenger_name" },
        { component: "body", key: "pnr" },
        { component: "body", key: "route" },
        { component: "body", key: "travel_date" },
      ],
    },
  };

  const els = {
    toggleConnBtn: document.getElementById("toggleConnBtn"),
    connPanel: document.getElementById("connPanel"),
    workspaceId: document.getElementById("workspaceId"),
    channelId: document.getElementById("channelId"),
    apiKey: document.getElementById("apiKey"),
    saveConnBtn: document.getElementById("saveConnBtn"),
    connNote: document.getElementById("connNote"),
    configName: document.getElementById("configName"),
    templateName: document.getElementById("templateName"),
    language: document.getElementById("language"),
    fetchBtn: document.getElementById("fetchBtn"),
    statusLine: document.getElementById("statusLine"),
    mappingSection: document.getElementById("mappingSection"),
    rulesSection: document.getElementById("rulesSection"),
    actionsBar: document.getElementById("actionsBar"),
    mediaRow: document.getElementById("mediaRow"),
    mediaHeader: document.getElementById("mediaHeader"),
    textHeaderRow: document.getElementById("textHeaderRow"),
    textHeaderLabel: document.getElementById("textHeaderLabel"),
    textHeaderField: document.getElementById("textHeaderField"),
    mapRows: document.getElementById("mapRows"),
    previewText: document.getElementById("previewText"),
    previewAttach: document.getElementById("previewAttach"),
    previewAttachLabel: document.getElementById("previewAttachLabel"),
    voucherPick: document.getElementById("voucherPick"),
    addVoucherBtn: document.getElementById("addVoucherBtn"),
    voucherChips: document.getElementById("voucherChips"),
    autoSelect: document.getElementById("autoSelect"),
    confirmBefore: document.getElementById("confirmBefore"),
    cancelBtn: document.getElementById("cancelBtn"),
    saveBtn: document.getElementById("saveBtn"),
    toast: document.getElementById("toast"),
  };

  const state = {
    fetched: false,
    template: null,
    maps: [],
    vouchers: ["Sales"],
  };

  function setStatus(text, stateName) {
    els.statusLine.textContent = text;
    els.statusLine.dataset.state = stateName || "idle";
  }

  function showToast(message) {
    els.toast.textContent = message;
    if (typeof els.toast.showModal === "function") {
      els.toast.showModal();
      setTimeout(() => els.toast.close(), 1600);
    } else {
      alert(message);
    }
  }

  function fieldOptions(selected) {
    return VOUCHER_FIELDS.map(
      (name) =>
        `<option value="${escapeAttr(name)}"${name === selected ? " selected" : ""}>${escapeHtml(name)}</option>`
    ).join("");
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function escapeAttr(value) {
    return escapeHtml(value).replaceAll("'", "&#39;");
  }

  function normalizeTemplate(raw, fallbackName, fallbackLang) {
    const item = Array.isArray(raw?.items) ? raw.items[0] : raw;
    if (!item) return null;

    let headerKind = "";
    let headerFormat = "";
    let preview = "";
    const components = item.components || [];
    for (const comp of components) {
      const type = String(comp.type || "").toLowerCase();
      if (type === "header") {
        headerFormat = String(comp.format || "TEXT").toUpperCase();
        if (["IMAGE", "VIDEO", "DOCUMENT", "GIF"].includes(headerFormat)) {
          headerKind = "media";
        } else {
          headerKind = "text";
          if (comp.text) preview += `[Header] ${comp.text} | `;
        }
      }
      if (type === "body" && comp.text) preview += comp.text;
    }

    const variables = (item.variables || []).map((v) => ({
      component: String(v.component || "body").toLowerCase(),
      key: String(v.key || ""),
    })).filter((v) => v.key);

    let headerKey = "";
    const bodyVars = [];
    for (const v of variables) {
      if (v.component === "header") {
        if (headerKind !== "media") {
          headerKind = headerKind || "text";
          headerKey = v.key;
        }
      } else {
        bodyVars.push(v);
      }
    }

    return {
      name: item.name || fallbackName,
      language: item.language?.code || fallbackLang,
      previewText: preview || "(No body text in template)",
      headerKind,
      headerFormat,
      headerKey,
      variables: bodyVars,
    };
  }

  function applyTemplate(template, sourceLabel) {
    state.fetched = true;
    state.template = template;
    state.maps = template.variables.map((v, index) => ({
      component: v.component,
      key: v.key,
      field: index === 0 ? "Party Name" : index === 1 ? "Voucher Number" : "Not Applicable",
    }));

    els.mappingSection.hidden = false;
    els.rulesSection.hidden = false;
    els.actionsBar.hidden = false;

    const hasMedia = template.headerKind === "media";
    const hasTextHeader = template.headerKind === "text" && template.headerKey;
    els.mediaRow.hidden = !hasMedia;
    els.textHeaderRow.hidden = !hasTextHeader;
    if (hasTextHeader) {
      els.textHeaderLabel.textContent = `Header {{${template.headerKey}}}`;
      els.textHeaderField.innerHTML = fieldOptions("Narration");
    }

    els.previewText.textContent = template.previewText;
    els.previewAttach.hidden = !hasMedia;
    if (hasMedia) {
      els.previewAttachLabel.textContent = els.mediaHeader.options[els.mediaHeader.selectedIndex]?.text || "Invoice PDF";
    }

    renderMaps();
    setStatus(
      sourceLabel === "live" ? "Template loaded" : "Template loaded (sample data)",
      "ok"
    );
  }

  function renderMaps() {
    els.mapRows.innerHTML = state.maps
      .map(
        (row, index) => `
      <div class="map-row" role="row" style="animation-delay:${index * 40}ms">
        <div class="var-key" role="cell">{{${escapeHtml(row.key)}}}</div>
        <div role="cell">
          <select data-map-index="${index}" aria-label="Map ${escapeAttr(row.key)}">
            ${fieldOptions(row.field)}
          </select>
        </div>
      </div>`
      )
      .join("");
  }

  function renderVoucherPick() {
    els.voucherPick.innerHTML = VOUCHER_TYPES.map(
      (name) => `<option value="${escapeAttr(name)}">${escapeHtml(name)}</option>`
    ).join("");
  }

  function renderVoucherChips() {
    els.voucherChips.innerHTML = state.vouchers
      .map(
        (name, index) => `
      <li>
        <span>${escapeHtml(name)}</span>
        <button type="button" data-remove-voucher="${index}" aria-label="Remove ${escapeAttr(name)}">×</button>
      </li>`
      )
      .join("");
  }

  async function fetchTemplate() {
    const name = els.templateName.value.trim();
    const lang = els.language.value.trim() || "en";
    if (!name) {
      setStatus("Enter Template Name first.", "error");
      return;
    }

    els.fetchBtn.disabled = true;
    setStatus("Fetching…", "busy");

    const workspaceId = els.workspaceId.value.trim();
    const channelId = els.channelId.value.trim();
    const apiKey = els.apiKey.value.trim();
    const canLive = workspaceId && channelId && apiKey;

    try {
      if (canLive) {
        const url = new URL(`${API_BASE}/api/v1/whatsapp/templates/${encodeURIComponent(name)}`);
        url.searchParams.set("channelId", channelId);
        url.searchParams.set("language", lang);
        const res = await fetch(url, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "X-Workspace-Id": workspaceId,
            Accept: "application/json",
          },
        });
        if (!res.ok) {
          throw new Error(`API ${res.status}`);
        }
        const json = await res.json();
        const template = normalizeTemplate(json, name, lang);
        if (!template) throw new Error("Empty template response");
        applyTemplate(template, "live");
        return;
      }

      const sampleKey = Object.keys(SAMPLES).find((k) => k === name) ||
        (name.includes("travel") ? "travel_ticket_confirm" : "sales_invoice_v2");
      // Slight delay so status flash is visible
      await new Promise((r) => setTimeout(r, 280));
      const sample = structuredClone(SAMPLES[sampleKey]);
      sample.name = name;
      sample.language = lang;
      applyTemplate(sample, "sample");
    } catch (err) {
      const sample = structuredClone(SAMPLES.sales_invoice_v2);
      sample.name = name;
      sample.language = lang;
      applyTemplate(sample, "sample");
      setStatus(
        `Live fetch failed (${err.message}). Showing sample mapping UI.`,
        "error"
      );
    } finally {
      els.fetchBtn.disabled = false;
    }
  }

  function packMaps() {
    const parts = [];
    if (state.template?.headerKind === "text" && state.template.headerKey) {
      parts.push(`header:${state.template.headerKey}=${els.textHeaderField.value}`);
    }
    for (const row of state.maps) {
      parts.push(`${row.component}:${row.key}=${row.field}`);
    }
    return parts.map((p) => `${p};`).join("");
  }

  function buildConfig() {
    return {
      name: els.configName.value.trim(),
      templateName: els.templateName.value.trim(),
      language: els.language.value.trim() || "en",
      mediaExport: state.template?.headerKind === "media" ? els.mediaHeader.value : "None",
      autoSelect: els.autoSelect.checked,
      confirmBeforeSend: els.confirmBefore.checked,
      voucherTypes: [...state.vouchers],
      varMapsText: packMaps(),
      previewText: state.template?.previewText || "",
      headerKind: state.template?.headerKind || "",
      maps: state.maps,
      savedAt: new Date().toISOString(),
    };
  }

  function saveConfig() {
    if (!state.fetched) {
      setStatus("Fetch the template first.", "error");
      return;
    }
    const config = buildConfig();
    if (!config.name) {
      setStatus("Config Name is required.", "error");
      return;
    }
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    const next = all.filter((c) => c.name !== config.name);
    next.unshift(config);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next.slice(0, 40)));

    const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${config.name.replace(/\s+/g, "-").toLowerCase() || "voucher-config"}.json`;
    a.click();
    URL.revokeObjectURL(a.href);

    navigator.clipboard?.writeText(config.varMapsText).catch(() => {});
    showToast("Config saved · maps pack copied");
  }

  function resetForm() {
    state.fetched = false;
    state.template = null;
    state.maps = [];
    state.vouchers = ["Sales"];
    els.mappingSection.hidden = true;
    els.rulesSection.hidden = true;
    els.actionsBar.hidden = true;
    els.configName.value = "Sales invoice alert";
    els.templateName.value = "sales_invoice_v2";
    els.language.value = "en";
    els.autoSelect.checked = false;
    els.confirmBefore.checked = true;
    renderVoucherChips();
    setStatus("Enter template details, then fetch.", "idle");
  }

  function loadConnection() {
    try {
      const saved = JSON.parse(localStorage.getItem(CONN_KEY) || "{}");
      els.workspaceId.value = saved.workspaceId || "";
      els.channelId.value = saved.channelId || "";
      els.apiKey.value = saved.apiKey || "";
      if (saved.workspaceId) els.connNote.textContent = "Connection remembered on this device.";
    } catch {
      /* ignore */
    }
  }

  function saveConnection() {
    localStorage.setItem(
      CONN_KEY,
      JSON.stringify({
        workspaceId: els.workspaceId.value.trim(),
        channelId: els.channelId.value.trim(),
        apiKey: els.apiKey.value.trim(),
      })
    );
    els.connNote.textContent = "Saved on this device.";
  }

  // Events
  els.toggleConnBtn.addEventListener("click", () => {
    const open = els.connPanel.hidden;
    els.connPanel.hidden = !open;
    els.toggleConnBtn.setAttribute("aria-expanded", String(open));
  });
  els.saveConnBtn.addEventListener("click", saveConnection);
  els.fetchBtn.addEventListener("click", fetchTemplate);
  els.addVoucherBtn.addEventListener("click", () => {
    const value = els.voucherPick.value;
    if (value && !state.vouchers.includes(value)) {
      state.vouchers.push(value);
      renderVoucherChips();
    }
  });
  els.voucherChips.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-remove-voucher]");
    if (!btn) return;
    state.vouchers.splice(Number(btn.dataset.removeVoucher), 1);
    renderVoucherChips();
  });
  els.mapRows.addEventListener("change", (event) => {
    const select = event.target.closest("select[data-map-index]");
    if (!select) return;
    state.maps[Number(select.dataset.mapIndex)].field = select.value;
  });
  els.mediaHeader.addEventListener("change", () => {
    els.previewAttachLabel.textContent =
      els.mediaHeader.options[els.mediaHeader.selectedIndex]?.text || "Invoice PDF";
  });
  els.cancelBtn.addEventListener("click", resetForm);
  els.saveBtn.addEventListener("click", saveConfig);
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a" && state.fetched) {
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      event.preventDefault();
      saveConfig();
    }
  });

  renderVoucherPick();
  renderVoucherChips();
  loadConnection();
})();
