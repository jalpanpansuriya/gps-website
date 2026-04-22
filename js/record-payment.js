(function () {
  "use strict";

  var session = null;
  var selectedStudent = null;
  var lastResults = [];
  var RESULTS_CAP = 300;

  var el = {
    user: document.getElementById("rp-user"),
    message: document.getElementById("rp-message"),
    denied: document.getElementById("rp-denied"),
    app: document.getElementById("rp-app"),
    logoutBtn: document.getElementById("logout-btn"),
    findClass: document.getElementById("rp-find-class"),
    findSection: document.getElementById("rp-find-section"),
    findName: document.getElementById("rp-find-name"),
    findRoll: document.getElementById("rp-find-roll"),
    findBtn: document.getElementById("find-student-btn"),
    results: document.getElementById("rp-results"),
    resultsBody: document.getElementById("rp-results-body"),
    resultsMeta: document.getElementById("rp-results-meta"),
    changeStudentBtn: document.getElementById("rp-change-student"),
    studentPicked: document.getElementById("rp-student-picked"),
    studentName: document.getElementById("rp-student-name"),
    year: document.getElementById("rp-year"),
    amount: document.getElementById("rp-amount"),
    payDate: document.getElementById("rp-date"),
    mode: document.getElementById("rp-mode"),
    reference: document.getElementById("rp-reference"),
    note: document.getElementById("rp-note"),
    form: document.getElementById("record-payment-form"),
    success: document.getElementById("rp-success")
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
      window.location.href = "login.html?redirect=record-payment.html";
      return;
    }
    session = s;
    if (el.user) {
      el.user.textContent = "Signed in as " + (s.user.email || "User");
    }

    if (el.logoutBtn) {
      el.logoutBtn.addEventListener("click", function () {
        window.supabaseClient.auth.signOut().then(function () {
          window.location.href = "login.html";
        });
      });
    }

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

    if (roleRes.data && roleRes.data.role !== "admin") {
      if (el.denied) el.denied.classList.remove("is-hidden");
      return;
    }

    if (el.app) el.app.classList.remove("is-hidden");
    if (el.payDate) {
      el.payDate.value = getIndiaDateString();
    }

    await populateYearSelect();
    if (el.findBtn) {
      el.findBtn.addEventListener("click", findStudents);
    }
    if (el.form) {
      el.form.addEventListener("submit", onSubmit);
    }
    if (el.changeStudentBtn) {
      el.changeStudentBtn.addEventListener("click", clearStudentSelection);
    }
    if (el.resultsBody) {
      el.resultsBody.addEventListener("click", function (ev) {
        var t = ev.target;
        if (!t || !t.closest) return;
        var btn = t.closest("button[data-student-idx]");
        if (!btn) return;
        var idx = parseInt(btn.getAttribute("data-student-idx"), 10);
        if (isNaN(idx) || !lastResults[idx]) return;
        selectStudent(lastResults[idx]);
      });
    }
  }

  function getIndiaDateString() {
    var now = new Date();
    var d = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
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
      showMessage("No academic years configured. Add one in Supabase or fee_structure seed.", "error");
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

  function showMessage(text, type) {
    if (!el.message) return;
    el.message.textContent = text || "";
    el.message.className = "attendance-message";
    if (type) {
      el.message.classList.add("attendance-message-" + type);
    }
  }

  function clearResultsUI() {
    lastResults = [];
    if (el.resultsBody) el.resultsBody.innerHTML = "";
    if (el.results) el.results.classList.add("is-hidden");
    if (el.resultsMeta) el.resultsMeta.textContent = "";
  }

  function clearPaymentFieldsOnly() {
    if (el.amount) el.amount.value = "";
    if (el.reference) el.reference.value = "";
    if (el.note) el.note.value = "";
    if (el.mode) el.mode.value = "";
  }

  function clearStudentSelection() {
    selectedStudent = null;
    if (el.studentPicked) el.studentPicked.classList.add("is-hidden");
    if (el.form) {
      el.form.classList.add("is-hidden");
      clearPaymentFieldsOnly();
    }
    if (el.success) {
      el.success.classList.add("is-hidden");
      el.success.innerHTML = "";
    }
    if (el.payDate) el.payDate.value = getIndiaDateString();
    if (el.results) el.results.classList.remove("is-hidden");
    showMessage("Choose a student from the list above, or run Search again with different filters.", "info");
  }

  async function findStudents() {
    var c = (el.findClass && el.findClass.value) ? el.findClass.value.trim() : "";
    var sec = (el.findSection && el.findSection.value) ? el.findSection.value.trim() : "";
    var nameQ = (el.findName && el.findName.value) ? el.findName.value.trim() : "";
    var roll = (el.findRoll && el.findRoll.value) ? el.findRoll.value.trim() : "";

    selectedStudent = null;
    if (el.studentPicked) el.studentPicked.classList.add("is-hidden");
    if (el.form) {
      el.form.classList.add("is-hidden");
      clearPaymentFieldsOnly();
    }
    if (el.success) {
      el.success.classList.add("is-hidden");
      el.success.innerHTML = "";
    }
    if (el.payDate) el.payDate.value = getIndiaDateString();
    clearResultsUI();

    if (!c) {
      showMessage("Enter a class to search (e.g. 5, 8, 10).", "error");
      return;
    }

    showMessage("Searching…", "info");

    var q = window.supabaseClient
      .from("students")
      .select("id, full_name, class_name, section, roll_no")
      .eq("is_active", true)
      .eq("class_name", c);

    if (sec) {
      q = q.eq("section", sec);
    }
    if (nameQ) {
      q = q.ilike("full_name", "%" + nameQ + "%");
    }
    if (roll) {
      q = q.eq("roll_no", roll);
    }

    q = q
      .order("section", { ascending: true, nullsFirst: true })
      .order("roll_no", { ascending: true, nullsFirst: true })
      .limit(RESULTS_CAP + 1);

    var res = await q;
    if (res.error) {
      showMessage("Search failed: " + res.error.message, "error");
      return;
    }

    var list = res.data || [];
    if (list.length === 0) {
      showMessage("No students match. Try a different class, name, or section; check spellings as in the database.", "error");
      return;
    }

    var overCap = list.length > RESULTS_CAP;
    var trimmed = overCap ? list.slice(0, RESULTS_CAP) : list;
    lastResults = trimmed;

    if (el.results) el.results.classList.remove("is-hidden");
    if (el.resultsMeta) {
      var capNote = overCap
        ? " (showing first " + RESULTS_CAP + " only — narrow with name or section)"
        : "";
      el.resultsMeta.innerHTML =
        trimmed.length +
        " student(s) found" +
        capNote +
        ". Click <strong>Select</strong> for the one you are receiving payment for.";
    }

    if (el.resultsBody) {
      el.resultsBody.innerHTML = "";
      trimmed.forEach(function (row, i) {
        var tr = document.createElement("tr");
        tr.innerHTML =
          "<td>" +
          escapeHtml(String(row.full_name || "—")) +
          "</td><td>" +
          escapeHtml(String(row.class_name != null ? row.class_name : "—")) +
          "</td><td>" +
          escapeHtml(row.section != null && String(row.section) !== "" ? String(row.section) : "—") +
          "</td><td>" +
          escapeHtml(row.roll_no != null ? String(row.roll_no) : "—") +
          '</td><td class="rp-select-cell"><button type="button" class="btn btn-primary rp-select-btn" data-student-idx="' +
          i +
          '">Select</button></td>';
        el.resultsBody.appendChild(tr);
      });
    }

    showMessage("Pick a student from the table, or adjust filters and search again.", "success");
  }

  function selectStudent(stu) {
    selectedStudent = stu;
    if (el.studentName) {
      el.studentName.textContent =
        stu.full_name +
        " — Class " +
        (stu.class_name || "-") +
        (stu.section ? " (" + stu.section + ")" : "") +
        " — Roll " +
        (stu.roll_no != null ? String(stu.roll_no) : "-");
    }
    if (el.studentPicked) el.studentPicked.classList.remove("is-hidden");
    if (el.form) {
      el.form.classList.remove("is-hidden");
      if (el.payDate) el.payDate.value = getIndiaDateString();
    }
    if (el.results) el.results.classList.add("is-hidden");
    showMessage("Student selected. Enter amount and other details, then record payment.", "success");
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (!selectedStudent) {
      showMessage("Select a student from the search results first.", "error");
      return;
    }

    var yearId = el.year && el.year.value;
    if (!yearId) {
      showMessage("Select academic year.", "error");
      return;
    }

    var amt = parseFloat((el.amount && el.amount.value) ? el.amount.value : "0");
    if (isNaN(amt) || amt <= 0) {
      showMessage("Enter a valid amount greater than 0.", "error");
      return;
    }

    var payDate = (el.payDate && el.payDate.value) || getIndiaDateString();
    var mode = el.mode && el.mode.value;
    if (!mode) {
      showMessage("Select payment mode.", "error");
      return;
    }

    var ref = (el.reference && el.reference.value) ? el.reference.value.trim() : "";
    var note = (el.note && el.note.value) ? el.note.value.trim() : "";

    showMessage("Recording payment…", "info");
    if (el.form) {
      el.form.querySelector("button[type=submit]").disabled = true;
    }

    var rpc = await window.supabaseClient.rpc("create_fee_payment", {
      p_student_id: selectedStudent.id,
      p_academic_year_id: yearId,
      p_amount_inr: amt,
      p_payment_date: payDate,
      p_payment_mode: mode,
      p_reference: ref || null,
      p_note: note || null
    });

    if (el.form) {
      el.form.querySelector("button[type=submit]").disabled = false;
    }

    if (rpc.error) {
      showMessage("Record failed: " + (rpc.error.message || "Unknown error"), "error");
      return;
    }

    var d = rpc.data;
    var row = Array.isArray(d) && d.length ? d[0] : d;
    if (!row || !row.id) {
      showMessage("Payment saved but could not read receipt. Check Table Editor: fee_payments.", "error");
      return;
    }

    var receiptUrl = "receipt.html?payment=" + encodeURIComponent(row.id);
    if (el.success) {
      el.success.classList.remove("is-hidden");
      el.success.innerHTML =
        '<p class="rp-success-p"><strong>Payment recorded.</strong> Receipt <strong>' +
        escapeHtml(row.receipt_number) +
        "</strong></p>" +
        '<p class="rp-success-p"><a class="btn btn-primary" href="' +
        receiptUrl +
        '">View / print receipt</a></p>';
    }
    showMessage("Success. Receipt: " + row.receipt_number, "success");
  }
})();
