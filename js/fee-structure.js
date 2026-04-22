(function () {
  "use strict";

  var session = null;
  var feeComponents = [];
  var amountInputs = {};

  var el = {
    user: document.getElementById("fee-user"),
    message: document.getElementById("fee-message"),
    denied: document.getElementById("fee-denied"),
    app: document.getElementById("fee-app"),
    logoutBtn: document.getElementById("logout-btn"),
    year: document.getElementById("fee-year"),
    className: document.getElementById("fee-class"),
    section: document.getElementById("fee-section"),
    loadBtn: document.getElementById("load-fees-btn"),
    saveBtn: document.getElementById("save-fees-btn"),
    tableBody: document.getElementById("fee-amounts-body"),
    meta: document.getElementById("fee-meta")
  };

  if (!window.supabaseClient) {
    showMessage("Supabase is not configured.", "error");
    return;
  }

  initialize();

  async function initialize() {
    var sessionRes = await window.supabaseClient.auth.getSession();
    var s = sessionRes.data && sessionRes.data.session ? sessionRes.data.session : null;
    if (!s) {
      window.location.href = "login.html?redirect=fee-structure.html";
      return;
    }
    session = s;
    if (el.user) {
      el.user.textContent = "Signed in as " + (s.user.email || "User");
    }

    el.logoutBtn.addEventListener("click", function () {
      window.supabaseClient.auth.signOut().then(function () {
        window.location.href = "login.html";
      });
    });

    var roleRes = await window.supabaseClient
      .from("teachers")
      .select("role")
      .eq("user_id", s.user.id)
      .maybeSingle();

    if (roleRes.error) {
      showMessage("Could not verify access: " + (roleRes.error.message || "Unknown error"), "error");
      if (el.denied) el.denied.classList.remove("is-hidden");
      return;
    }

    var role = roleRes.data && roleRes.data.role;
    if (role !== "admin") {
      if (el.denied) el.denied.classList.remove("is-hidden");
      return;
    }

    if (el.app) el.app.classList.remove("is-hidden");

    var compRes = await window.supabaseClient
      .from("fee_components")
      .select("id, code, name, is_optional, sort_order")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    if (compRes.error) {
      showMessage("Failed to load fee components: " + compRes.error.message, "error");
      return;
    }
    feeComponents = compRes.data || [];
    renderAmountRows();
    await populateYearSelect();

    el.loadBtn.addEventListener("click", loadAmounts);
    el.saveBtn.addEventListener("click", saveAmounts);
  }

  function showMessage(text, type) {
    if (!el.message) return;
    el.message.textContent = text || "";
    el.message.className = "attendance-message";
    if (type) {
      el.message.classList.add("attendance-message-" + type);
    }
  }

  function setWorking(isWorking) {
    el.loadBtn.disabled = isWorking;
    el.saveBtn.disabled = isWorking;
    el.loadBtn.textContent = isWorking ? "Please wait…" : "Load";
    el.saveBtn.textContent = isWorking ? "Saving…" : "Save for this class";
  }

  function normalizeSection() {
    var t = (el.section && el.section.value) ? el.section.value.trim() : "";
    return t || null;
  }

  function normalizeClass() {
    return (el.className && el.className.value) ? el.className.value.trim() : "";
  }

  async function populateYearSelect() {
    if (!el.year) return;
    el.year.innerHTML = '<option value="">Select academic year</option>';
    var res = await window.supabaseClient
      .from("academic_years")
      .select("id, label, is_current")
      .order("label", { ascending: false });
    if (res.error) {
      showMessage("Could not load academic years: " + res.error.message, "error");
      return;
    }
    var rows = res.data || [];
    if (rows.length === 0) {
      showMessage(
        "No academic years found. Add one in Supabase (Table Editor → academic_years) or run the seed in fee_structure_v1.sql.",
        "error"
      );
      return;
    }
    var currentId = null;
    rows.forEach(function (row) {
      var opt = document.createElement("option");
      opt.value = row.id;
      var lab = row.label;
      if (row.is_current) {
        lab += " (current)";
        currentId = row.id;
      }
      opt.textContent = lab;
      el.year.appendChild(opt);
    });
    if (currentId) {
      el.year.value = currentId;
    } else if (rows.length === 1) {
      el.year.value = rows[0].id;
    }
  }

  function renderAmountRows() {
    if (!el.tableBody) return;
    el.tableBody.innerHTML = "";
    amountInputs = {};
    feeComponents.forEach(function (c) {
      var tr = document.createElement("tr");
      var nameCell = document.createElement("td");
      nameCell.textContent = c.name;
      if (c.is_optional) {
        nameCell.appendChild(document.createTextNode(" "));
        var s = document.createElement("span");
        s.className = "fee-optional-pill";
        s.textContent = "optional";
        nameCell.appendChild(s);
      }
      var codeCell = document.createElement("td");
      codeCell.className = "fee-code-cell";
      codeCell.textContent = c.code;
      var inputCell = document.createElement("td");
      var input = document.createElement("input");
      input.type = "number";
      input.min = "0";
      input.step = "0.01";
      input.className = "fee-amount-input";
      input.setAttribute("aria-label", c.name + " amount in rupees");
      input.dataset.feeComponentId = c.id;
      inputCell.appendChild(input);
      amountInputs[c.id] = input;
      tr.appendChild(nameCell);
      tr.appendChild(codeCell);
      tr.appendChild(inputCell);
      el.tableBody.appendChild(tr);
    });
  }

  function getSelectedYearId() {
    return el.year && el.year.value ? el.year.value : "";
  }

  async function loadAmounts() {
    var yearId = getSelectedYearId();
    var className = normalizeClass();
    if (!yearId) {
      showMessage("Select an academic year first.", "error");
      return;
    }
    if (!className) {
      showMessage("Enter a class (must match the value in the student list, e.g. 5 or 10).", "error");
      return;
    }

    setWorking(true);
    showMessage("Loading…", "info");
    if (el.meta) el.meta.textContent = "";

    var sec = normalizeSection();
    var q = window.supabaseClient
      .from("class_fee_lines")
      .select("fee_component_id, amount_inr")
      .eq("academic_year_id", yearId)
      .eq("class_name", className);
    if (sec) {
      q = q.eq("section", sec);
    } else {
      q = q.is("section", null);
    }

    var res = await q;
    if (res.error) {
      showMessage("Load failed: " + res.error.message, "error");
      setWorking(false);
      return;
    }

    var byComp = {};
    (res.data || []).forEach(function (r) {
      byComp[r.fee_component_id] = r.amount_inr;
    });
    feeComponents.forEach(function (c) {
      var input = amountInputs[c.id];
      if (!input) return;
      if (Object.prototype.hasOwnProperty.call(byComp, c.id)) {
        var val = byComp[c.id];
        input.value = val == null ? "" : String(val);
      } else {
        input.value = "";
      }
    });

    if (el.meta) {
      el.meta.textContent =
        "Loaded " +
        (res.data || []).length +
        " line(s) for class " +
        className +
        (sec ? " section " + sec : " (all sections)");
    }
    showMessage("Amounts loaded. Edit and Save, or enter new amounts and Save.", "success");
    setWorking(false);
  }

  function parseAmount(str) {
    if (str == null || String(str).trim() === "") {
      return 0;
    }
    var n = parseFloat(String(str).replace(/,/g, ""));
    if (isNaN(n) || n < 0) {
      return null;
    }
    return Math.round(n * 100) / 100;
  }

  async function saveAmounts() {
    var yearId = getSelectedYearId();
    var className = normalizeClass();
    if (!yearId) {
      showMessage("Select an academic year first.", "error");
      return;
    }
    if (!className) {
      showMessage("Enter a class.", "error");
      return;
    }

    var sec = normalizeSection();
    var toSave = [];
    for (var i = 0; i < feeComponents.length; i++) {
      var c = feeComponents[i];
      var input = amountInputs[c.id];
      if (!input) continue;
      var parsed = parseAmount(input.value);
      if (parsed === null) {
        showMessage("Invalid amount for " + c.name + ". Use 0 or a positive number.", "error");
        return;
      }
      toSave.push({ componentId: c.id, amount: parsed });
    }

    setWorking(true);
    showMessage("Saving…", "info");

    for (var j = 0; j < toSave.length; j++) {
      var item = toSave[j];
      var err = await upsertLine(yearId, className, sec, item.componentId, item.amount);
      if (err) {
        showMessage("Save failed: " + err, "error");
        setWorking(false);
        return;
      }
    }

    showMessage("Fee structure saved for " + className + (sec ? " section " + sec : " (all sections)") + ".", "success");
    if (el.meta) {
      el.meta.textContent = "Last saved: " + new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
    }
    setWorking(false);
  }

  function buildLineQuery(yearId, className, section, componentId) {
    var q = window.supabaseClient
      .from("class_fee_lines")
      .select("id")
      .eq("academic_year_id", yearId)
      .eq("class_name", className)
      .eq("fee_component_id", componentId);
    if (section) {
      return q.eq("section", section);
    }
    return q.is("section", null);
  }

  async function upsertLine(yearId, className, section, componentId, amount) {
    var find = await buildLineQuery(yearId, className, section, componentId).maybeSingle();
    if (find.error) {
      return find.error.message;
    }
    if (find.data && find.data.id) {
      var up = await window.supabaseClient
        .from("class_fee_lines")
        .update({ amount_inr: amount })
        .eq("id", find.data.id);
      if (up.error) {
        return up.error.message;
      }
      return null;
    }
    var ins = await window.supabaseClient.from("class_fee_lines").insert({
      academic_year_id: yearId,
      class_name: className,
      section: section,
      fee_component_id: componentId,
      amount_inr: amount
    });
    if (ins.error) {
      return ins.error.message;
    }
    return null;
  }
})();
