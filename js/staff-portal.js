(function () {
  "use strict";

  var userEl = document.getElementById("portal-user");
  var welcomeEl = document.getElementById("portal-welcome");
  var metaEl = document.getElementById("portal-meta");
  var logoutBtn = document.getElementById("portal-logout-btn");

  if (!window.supabaseClient) {
    if (userEl) {
      userEl.textContent = "Supabase is not configured.";
    }
    return;
  }

  function formatIndiaDateTime() {
    var now = new Date();
    try {
      var d = new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric"
      }).format(now);
      var t = new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        hour: "numeric",
        minute: "2-digit",
        hour12: true
      }).format(now);
      return d + " · " + t + " IST";
    } catch (e) {
      return now.toLocaleString();
    }
  }

  function capitalizeWord(word) {
    if (!word) {
      return "";
    }
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }

  /**
   * Prefer user_metadata (set in Supabase or via updateUser) so "Welcome" uses real names,
   * not the email local part. Order: first_name → first word of name/full_name/display_name → email hint.
   */
  function firstNameForWelcome(user) {
    if (!user) {
      return "";
    }
    var m = user.user_metadata || {};
    if (m.first_name && String(m.first_name).trim()) {
      return String(m.first_name).trim();
    }
    var multi = m.name || m.full_name || m.display_name;
    if (multi && String(multi).trim()) {
      var w = String(multi).trim().split(/\s+/)[0];
      if (w) {
        return w;
      }
    }
    var email = user.email || "";
    if (email.indexOf("@") < 0) {
      return "";
    }
    var local = email.split("@")[0] || "";
    var fromEmail = local.split(/[._-]/)[0] || local;
    return fromEmail;
  }

  function greetingForUser(user) {
    var raw = firstNameForWelcome(user);
    if (!raw) {
      return "Welcome";
    }
    return "Welcome, " + capitalizeWord(raw);
  }

  function bindLogout() {
    if (logoutBtn) {
      logoutBtn.addEventListener("click", function () {
        window.supabaseClient.auth.signOut().then(function () {
          window.location.href = "login.html";
        });
      });
    }
  }

  window.supabaseClient.auth.getSession().then(function (result) {
    var session = result.data && result.data.session;
    if (!session) {
      window.location.href = "login.html?redirect=staff-portal.html";
      return;
    }
    var user = session.user;
    var email = user && user.email ? user.email : "";
    if (welcomeEl) {
      welcomeEl.textContent = greetingForUser(user);
    }
    if (metaEl) {
      metaEl.textContent = formatIndiaDateTime();
    }
    if (userEl) {
      userEl.textContent = email ? "Signed in as " + email : "Signed in";
    }
    bindLogout();
  });
})();
