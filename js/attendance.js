(function () {
  "use strict";

  var attendanceDateInput = document.getElementById("attendance-date");
  var classFilterInput = document.getElementById("class-filter");
  var sectionFilterInput = document.getElementById("section-filter");
  var loadStudentsBtn = document.getElementById("load-students-btn");
  var tableBody = document.getElementById("attendance-table-body");
  var messageBox = document.getElementById("attendance-message");
  var attendanceMeta = document.getElementById("attendance-meta");

  if (!window.supabaseClient) {
    showMessage("Supabase client not loaded. Check API key setup.", "error");
    return;
  }

  setDefaultDate();
  loadStudentsBtn.addEventListener("click", loadStudents);

  function setDefaultDate() {
    attendanceDateInput.value = getIndiaDateString();
  }

  function getIndiaDateString() {
    var now = new Date();
    var indiaDate = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    var year = indiaDate.getFullYear();
    var month = String(indiaDate.getMonth() + 1).padStart(2, "0");
    var day = String(indiaDate.getDate()).padStart(2, "0");
    return year + "-" + month + "-" + day;
  }

  function maskPhone(phone) {
    if (!phone || phone.length < 4) {
      return phone || "-";
    }
    var last4 = phone.slice(-4);
    return "******" + last4;
  }

  function showMessage(text, type) {
    messageBox.textContent = text;
    messageBox.className = "attendance-message";
    if (type) {
      messageBox.classList.add("attendance-message-" + type);
    }
  }

  function setLoadingState(isLoading) {
    loadStudentsBtn.disabled = isLoading;
    loadStudentsBtn.textContent = isLoading ? "Loading..." : "Load Students";
  }

  async function loadStudents() {
    var className = classFilterInput.value.trim();
    var section = sectionFilterInput.value.trim();
    var selectedDate = attendanceDateInput.value || getIndiaDateString();

    setLoadingState(true);
    showMessage("", "");
    attendanceMeta.textContent = "";

    try {
      var query = window.supabaseClient
        .from("students")
        .select("id, roll_no, full_name, class_name, section, parent_phone")
        .eq("is_active", true)
        .order("roll_no", { ascending: true, nullsFirst: false });

      if (className) {
        query = query.eq("class_name", className);
      }
      if (section) {
        query = query.eq("section", section);
      }

      var studentsResult = await query;
      if (studentsResult.error) {
        throw studentsResult.error;
      }

      var students = studentsResult.data || [];
      if (students.length === 0) {
        renderEmpty("No students found for selected filters.");
        attendanceMeta.textContent = "0 students loaded";
        return;
      }

      var ids = students.map(function (student) {
        return student.id;
      });

      var attendanceResult = await window.supabaseClient
        .from("attendance")
        .select("student_id, event_type")
        .eq("attendance_date", selectedDate)
        .in("student_id", ids);

      if (attendanceResult.error) {
        throw attendanceResult.error;
      }

      var statusByStudent = {};
      (attendanceResult.data || []).forEach(function (row) {
        if (!statusByStudent[row.student_id]) {
          statusByStudent[row.student_id] = { IN: false, OUT: false };
        }
        statusByStudent[row.student_id][row.event_type] = true;
      });

      renderStudents(students, statusByStudent, selectedDate);
      attendanceMeta.textContent = students.length + " students loaded for " + selectedDate;
      showMessage("Students loaded successfully.", "success");
    } catch (error) {
      renderEmpty("Unable to load students.");
      showMessage("Load failed: " + (error.message || "Unknown error"), "error");
    } finally {
      setLoadingState(false);
    }
  }

  function renderEmpty(text) {
    tableBody.innerHTML = '<tr><td colspan="7" class="attendance-empty">' + text + "</td></tr>";
  }

  function renderStudents(students, statusByStudent, selectedDate) {
    tableBody.innerHTML = "";

    students.forEach(function (student) {
      var status = statusByStudent[student.id] || { IN: false, OUT: false };
      var statusLabel = getStatusLabel(status);
      function cell(label, value) {
        return (
          '<td><span class="attendance-cell-label">' + label + '</span>' +
          '<span class="attendance-cell-value">' + value + "</span></td>"
        );
      }

      var tr = document.createElement("tr");
      tr.innerHTML =
        cell("Roll No", student.roll_no || "-") +
        cell("Student", student.full_name) +
        cell("Class", student.class_name) +
        cell("Section", student.section || "-") +
        cell("Parent Phone", maskPhone(student.parent_phone)) +
        cell("Status", '<span class="attendance-status-pill">' + statusLabel + "</span>") +
        '<td class="attendance-actions-cell">' +
        '<span class="attendance-cell-label">Actions</span>' +
        '<button class="btn attendance-action-btn attendance-in-btn" type="button">Mark IN</button>' +
        '<button class="btn attendance-action-btn attendance-out-btn" type="button">Mark OUT</button>' +
        "</td>";

      var inBtn = tr.querySelector(".attendance-in-btn");
      var outBtn = tr.querySelector(".attendance-out-btn");

      inBtn.disabled = status.IN;
      outBtn.disabled = status.OUT;

      inBtn.addEventListener("click", function () {
        markAttendance(student, "IN", selectedDate, inBtn, outBtn);
      });
      outBtn.addEventListener("click", function () {
        markAttendance(student, "OUT", selectedDate, inBtn, outBtn);
      });

      tableBody.appendChild(tr);
    });
  }

  function getStatusLabel(status) {
    if (status.IN && status.OUT) {
      return "IN & OUT marked";
    }
    if (status.IN) {
      return "IN marked";
    }
    if (status.OUT) {
      return "OUT marked";
    }
    return "Not marked";
  }

  async function markAttendance(student, eventType, selectedDate, inBtn, outBtn) {
    inBtn.disabled = true;
    outBtn.disabled = true;
    showMessage("Saving attendance for " + student.full_name + "...", "info");

    try {
      var attendanceInsert = await window.supabaseClient
        .from("attendance")
        .insert({
          student_id: student.id,
          attendance_date: selectedDate,
          event_type: eventType,
          note: "Marked from website attendance panel"
        })
        .select("id")
        .single();

      if (attendanceInsert.error) {
        throw attendanceInsert.error;
      }

      var messageBody = eventType === "IN"
        ? "Dear Parent, " + student.full_name + " has reached school safely."
        : "Dear Parent, " + student.full_name + " has left school.";

      var smsInsert = await window.supabaseClient
        .from("sms_logs")
        .insert({
          attendance_id: attendanceInsert.data.id,
          student_id: student.id,
          phone: student.parent_phone,
          message_type: eventType,
          message_body: messageBody,
          status: "QUEUED"
        });

      if (smsInsert.error) {
        throw smsInsert.error;
      }

      showMessage(
        student.full_name + " marked " + eventType + ". SMS queued for parent.",
        "success"
      );
      await loadStudents();
    } catch (error) {
      if (error.code === "23505") {
        showMessage(student.full_name + " already has " + eventType + " marked for this date.", "error");
      } else {
        showMessage("Attendance save failed: " + (error.message || "Unknown error"), "error");
      }

      inBtn.disabled = false;
      outBtn.disabled = false;
    }
  }
})();
