// Only these first-party pages may receive automatic login interactions.
export function isPassportUrl(value) {
  try { return new URL(value).origin === "https://passport.ksyun.com"; } catch { return false; }
}

export class LoginError extends Error {
  constructor(code, message, requiresUserAction = false) {
    super(message);
    this.code = code;
    this.requiresUserAction = requiresUserAction;
  }
}

export const expiredSession = () => new LoginError("AUTH_EXPIRED", "登录状态已过期");

// Runs inside the passport page. Passwords never leave the browser, including errors.
// Use the site's own handlers, including its visible, server-authorized optional skip.
export function loginPageStep({ submitted = false, skipped = false, accountId = "", expectedUsername = "" } = {}) {
  if (location.origin !== "https://passport.ksyun.com") return { state: "unsupported" };
  const visible = (el) => Boolean(el && el.getClientRects().length &&
    el.ownerDocument.defaultView.getComputedStyle(el).visibility !== "hidden" &&
    el.ownerDocument.defaultView.getComputedStyle(el).display !== "none");
  const documents = [];
  const visit = (doc, x = 0, y = 0) => {
    if (doc.location.origin !== "https://passport.ksyun.com") return;
    if (["/iframe-login.html", "/iframe-login-iam.html"].includes(doc.location.pathname)) documents.push({ doc, x, y });
    for (const frame of doc.querySelectorAll("iframe")) {
      if (!visible(frame)) continue;
      try {
        const rect = frame.getBoundingClientRect();
        if (frame.contentDocument) visit(frame.contentDocument, x + rect.left, y + rect.top);
      } catch { /* Do not enter third-party frames. */ }
    }
  };
  visit(document);
  if (!documents.length) return { state: "loading" };
  if (documents.length !== 1) return { state: "unsupported" };
  const { doc, x, y } = documents[0];
  const get = (id) => doc.getElementById(id);
  const skip = get("skip");
  if (visible(skip) && !skip.disabled) {
    if (!skipped && !doc.documentElement.dataset.aicpSkipSubmitted) {
      doc.documentElement.dataset.aicpSkipSubmitted = "true";
      skip.click();
      return { state: "skipped" };
    }
    return { state: "waiting" };
  }
  if (["imgcode", "mfaCode", "code_number", "code_number_validate", "code_number_bind", "mobile_email"].some((id) => visible(get(id)))) {
    return { state: "verification_required" };
  }
  if ([...doc.querySelectorAll(".input-message-wrap")].some((el) => visible(el) && el.textContent.trim())) {
    return { state: "login_failed" };
  }
  const password = get("password");
  const username = get("username");
  const account = get("account_id");
  const button = get("login");
  if (get("authMethod")?.value !== "password" || !visible(password) || !visible(username) || !visible(button)) {
    return { state: "unsupported" };
  }
  if (submitted || doc.documentElement.dataset.aicpPasswordSubmitted) return { state: "waiting" };
  // IAM's parent account field is not always covered by the password manager.
  if (account && !account.value && accountId) {
    account.value = accountId;
    account.dispatchEvent(new doc.defaultView.Event("input", { bubbles: true }));
    account.dispatchEvent(new doc.defaultView.Event("change", { bubbles: true }));
  }
  if (!username.value || !password.value || (account && !account.value)) {
    const rect = username.getBoundingClientRect();
    return { state: "credentials_missing", focus: { x: x + rect.left + rect.width / 2, y: y + rect.top + rect.height / 2 } };
  }
  if (expectedUsername && username.value !== expectedUsername) return { state: "account_selection_required" };
  if (button.disabled) return { state: "waiting" };
  doc.documentElement.dataset.aicpPasswordSubmitted = "true";
  button.click();
  return { state: "submitted", accountId: account?.value || "" };
}
