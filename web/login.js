// Shared public-page boot: capability-aware calls to action, without loading app modules.
const authOptions = fetch("/api/auth/options", {
  credentials: "same-origin",
  signal: AbortSignal.timeout(10000),
}).then((r) => {
  if (!r.ok) throw new Error("Options unavailable");
  return r.json();
});
const signedIn = document.body.hasAttribute("data-signed-in"); // the page already offers the app
authOptions
  .then((options) => {
    if (signedIn) return;
    const open = options.registration === true;
    const status = document.getElementById("registration-status");
    if (status) status.textContent = open ? "OPEN FOR REGISTRATION" : "REGISTRATION CLOSED";
    document.querySelectorAll("[data-registration-copy]").forEach((el) => {
      el.textContent = open ? el.dataset.open : el.dataset.closed;
    });
    document.querySelectorAll("[data-register-link]").forEach((link) => {
      if (link.closest(".nav-actions")) link.hidden = !open;
      const here = link.getAttribute("href") || "";
      link.href = open ? (here.startsWith("/register") ? here : "/register") : "/login"; // keep ?w=spoons
      link.firstChild.textContent = open ? "Create your free account " : "Log in ";
    });
  })
  .catch(() => {
    if (signedIn) return;
    const status = document.getElementById("registration-status");
    if (status) status.textContent = "SIGNUP AVAILABILITY UNKNOWN";
    document.querySelectorAll("[data-registration-copy]").forEach((el) => {
      el.textContent =
        "We couldn’t check registration availability. Open the account page to try again.";
    });
  });

if (document.getElementById("signin-form")) initAuth();

function initAuth() {
  const e = new URLSearchParams(location.search).get("e");
  const msgs = {
    bad: "That username or password didn't match. Try again. (After ten wrong tries an account is paused for 15 minutes.)",
    locked: "Too many attempts. Wait 15 minutes, then try again.",
    disabled:
      "This account has been switched off. Ask whoever runs this Jiggered to turn it back on.",
    busy: "Lots of people are signing in at once. Try again in a moment.",
    expired:
      "You were signed out: your session ended or was revoked. Changes that had not been sent were not kept.",
    deleted: "Your account and its data were deleted from this server.",
  };
  const msg = msgs[Object.hasOwn(msgs, e) ? e : ""];
  if (msg) {
    const line = document.getElementById("err");
    line.textContent = msg;
    // A deleted account is news, not an error.
    if (e === "deleted") line.className = "msg";
  }
  // A visitor who came from the Spoon Theory guide starts in spoons. This is best effort: it survives the email
  // round trip only when the link is opened in the same browser; the first-run checklist asks everyone else.
  try {
    if (new URLSearchParams(location.search).get("w") === "spoons")
      localStorage.setItem("jiggered:w", "spoons");
  } catch {}
  // A failed sign-in reloads the page; keep the typed username (never the password) for this tab only.
  const signin = document.getElementById("signin-form");
  signin.addEventListener("submit", () => {
    try {
      sessionStorage.setItem("jiggered:u", signin.elements.username?.value || "");
    } catch {}
  });
  try {
    const kept = sessionStorage.getItem("jiggered:u"),
      verified = sessionStorage.getItem("jiggered:v") === "1";
    sessionStorage.removeItem("jiggered:u");
    sessionStorage.removeItem("jiggered:v");
    if ((e === "bad" || e === "busy" || verified) && kept && signin.elements.username) {
      signin.elements.username.value = kept;
      signin.elements.password?.focus();
    }
  } catch {}

  const $ = (id) => document.getElementById(id);
  const forms = ["signin", "register", "forgot", "reset", "verify", "two-step"];
  function show(which, focus = true) {
    for (const name of forms) $(name + "-form").hidden = name !== which;
    const heading = $(which + "-form").querySelector("h1");
    document.title = heading.textContent + " — Jiggered";
    if (focus) {
      heading.tabIndex = -1;
      heading.focus();
    }
  }
  $("open-register").addEventListener("click", () => {
    history.replaceState(null, "", "/register");
    show("register");
  });
  $("open-forgot").addEventListener("click", () => show("forgot"));
  document.querySelectorAll("[data-signin]").forEach((b) =>
    b.addEventListener("click", () => {
      history.replaceState(null, "", "/login");
      show("signin");
    }),
  );
  const registrationRoute = location.pathname === "/register";
  if (registrationRoute) {
    show("register", false);
    $("register-form").querySelector("[type=submit]").disabled = true;
    $("auth-options-status").hidden = false;
    $("auth-options-status").textContent = "Checking account availability…";
  }
  authOptions
    .then((o) => {
      $("open-register").hidden = !o.registration;
      $("open-forgot").hidden = !o.recovery;
      const status = $("auth-options-status");
      if (registrationRoute && !o.registration) {
        show("signin", false);
        status.hidden = false;
        status.textContent =
          "Registration is closed on this server. Sign in with an existing account, or ask the administrator to create one for you.";
      } else {
        status.hidden = true;
        $("register-form").querySelector("[type=submit]").disabled = false;
      }
    })
    .catch(() => {
      const status = $("auth-options-status");
      status.hidden = false;
      status.textContent =
        "Could not check account availability. You can still sign in. Reload this page to try registration or email recovery again.";
      if (registrationRoute) show("signin", false);
    });
  document.querySelectorAll("input[type=password]").forEach((input) => {
    // The button sits inside the field's right edge (44px high), so it takes no row of its own.
    const label = input.closest("label"),
      hadFocus = document.activeElement === input; // moving a focused node drops its focus
    const wrap = document.createElement("div");
    wrap.className = "password-field";
    label.replaceWith(wrap);
    wrap.append(label);
    if (hadFocus) input.focus();
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "password-toggle";
    toggle.textContent = "Show";
    toggle.setAttribute("aria-label", "Show password");
    toggle.setAttribute("aria-controls", input.id);
    toggle.setAttribute("aria-pressed", "false");
    wrap.append(toggle);
    toggle.addEventListener("click", () => {
      const visible = input.type === "password";
      input.type = visible ? "text" : "password";
      toggle.textContent = visible ? "Hide" : "Show";
      toggle.setAttribute("aria-label", visible ? "Hide password" : "Show password");
      toggle.setAttribute("aria-pressed", String(visible));
    });
  });
  let token = "";
  function readFragment() {
    const fragment = new URLSearchParams(location.hash.slice(1));
    token = fragment.get("reset") || fragment.get("verify") || "";
    if (location.hash) {
      history.replaceState(null, "", location.pathname + location.search);
      show(fragment.has("reset") ? "reset" : fragment.has("verify") ? "verify" : "signin");
    } else if (new URLSearchParams(location.search).get("step") === "2") show("two-step");
  }
  readFragment();
  window.addEventListener("hashchange", readFragment);
  // "ada@example.com" -> "a•••@example.com": enough to spot a typo, not the whole address on screen.
  const maskEmail = (value) => {
    const [name = "", domain = ""] = value.trim().split("@");
    return domain ? `${name.slice(0, 1)}•••@${domain}` : value.trim();
  };
  // A link just went out: hold the button for a few seconds, with the time left on it, so it is not pressed twice.
  function cooldown(button, seconds) {
    let left = seconds;
    button.disabled = true;
    button.textContent = `Send another link (${left}s)`;
    const tick = setInterval(() => {
      left -= 1;
      if (left > 0) {
        button.textContent = `Send another link (${left}s)`;
        return;
      }
      clearInterval(tick);
      button.disabled = false;
      button.textContent = "Send another link";
    }, 1000);
  }
  async function submit(which, path, body, success) {
    const form = $(which + "-form"),
      button = form.querySelector("[type=submit]"),
      message = $(which + "-msg");
    if (button.disabled) return;
    button.disabled = true;
    form.setAttribute("aria-busy", "true");
    message.textContent = "Working…";
    message.classList.remove("err");
    try {
      const r = await fetch("/api/auth/" + path, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "jiggered",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      });
      const value = await r.json().catch(() => ({}));
      message.textContent = value.message || value.error || "Request failed. Try again.";
      message.classList.toggle("err", !r.ok);
      if (!r.ok && which === "register" && r.status === 409) $("register-name")?.focus();
      if (
        !r.ok &&
        (which === "verify" || which === "reset") &&
        !form.querySelector("[data-new-link]")
      ) {
        const next = document.createElement("button");
        next.type = "button";
        next.className = "secondary";
        next.dataset.newLink = "";
        next.textContent = "Request a new link";
        next.addEventListener("click", () => {
          history.replaceState(null, "", "/login");
          show(which === "reset" ? "forgot" : "register");
        });
        message.after(next);
      }
      if (r.ok) {
        if (which === "register" || which === "forgot") {
          // Say what happened where the eye is: who it went to, and when to try again.
          const box = $(which + "-sent");
          box.querySelector("[data-sent-to]").textContent = maskEmail($(which + "-email").value);
          box.hidden = false;
          box.focus();
          message.textContent = "";
          setTimeout(() => cooldown(button, 30), 0); // after `finally` re-enables the button
        }
        success?.();
        if (which === "verify" && value.username) {
          // The next page is sign-in: have the username waiting and the cursor in the password box.
          try {
            sessionStorage.setItem("jiggered:u", value.username);
            sessionStorage.setItem("jiggered:v", "1");
          } catch {}
        }
        if (which === "verify" || which === "reset") {
          button.hidden = true;
          form.querySelectorAll("label,.password-field").forEach((el) => (el.hidden = true));
          // The instructions that led here are done: say what happened, and offer the one next step.
          const heading = form.querySelector("h1");
          if (heading)
            heading.textContent = which === "verify" ? "Email verified" : "Password changed";
          form.querySelectorAll(".meta, [data-signin]").forEach((el) => (el.hidden = true));
          const next = document.createElement("button");
          next.type = "button";
          next.className = "primary";
          next.textContent = "Sign in";
          next.addEventListener("click", () => location.assign("/login"));
          message.after(next);
          next.focus();
        }
        // After a sent link the person may need "Send another link", so keep what they typed for that.
        if (which !== "register" && which !== "forgot")
          form.querySelectorAll("input[type=password]").forEach((el) => (el.value = ""));
      }
    } catch {
      message.textContent = "Could not connect. Check your connection and try again.";
      message.classList.add("err");
    } finally {
      button.disabled = false;
      form.removeAttribute("aria-busy");
    }
  }
  function passwordsMatch(which) {
    if ($(which + "-password").value === $(which + "-confirm").value) return true;
    $(which + "-msg").textContent = "The passwords do not match.";
    $(which + "-msg").classList.add("err");
    $(which + "-confirm").focus();
    return false;
  }
  $("register-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    // No confirm box: "Show" lets the person check what they typed, and a wrong one is fixed by email recovery.
    submit("register", "register", {
      username: $("register-name").value,
      email: $("register-email").value,
      password: $("register-password").value,
    });
  });
  $("forgot-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    submit("forgot", "forgot-password", { email: $("forgot-email").value });
  });
  $("verify-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    submit("verify", "verify", { token }, () => (token = ""));
  });
  $("reset-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    if (passwordsMatch("reset"))
      submit(
        "reset",
        "reset-password",
        {
          token,
          password: $("reset-password").value,
          code: $("reset-code").value,
        },
        () => (token = ""),
      );
  });
  $("two-step-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    submit("two-step", "two-step", { code: $("two-step-code").value }, () => location.assign("/"));
  });
}
