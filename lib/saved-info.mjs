import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { pathToFileURL } from "node:url";

const execute = promisify(execFile);
// Only the non-password IAM parent-account field is queried. Never open Login
// Data, Cookies, or enumerate other saved fields. Multiple parents are ambiguous.
const query = `
  import { DatabaseSync } from "node:sqlite";
  const db = new DatabaseSync(process.argv[1], { readOnly: true });
  try {
    const rows = db.prepare("SELECT DISTINCT trim(value) AS value FROM autofill WHERE name = ? AND trim(value) <> '' LIMIT 2").all("account_id");
    process.stdout.write(JSON.stringify(rows.length === 1 ? rows[0].value : null));
  } finally { db.close(); }
`;

export async function readSavedParentAccount(profilePath) {
  // Edge holds an exclusive SQLite lock. Read the committed main file without
  // locking or copying the profile. An unavailable/uncommitted entry is a miss.
  const url = pathToFileURL(path.join(profilePath, "Default", "Web Data"));
  url.search = "mode=ro&immutable=1";
  try {
    const { stdout } = await execute(process.execPath,
      ["--no-warnings", "--input-type=module", "--eval", query, url.href],
      { timeout: 3000, maxBuffer: 4096, windowsHide: true });
    const value = JSON.parse(stdout);
    return typeof value === "string" && value.length <= 255 && !/[\r\n\0]/.test(value) ? value : "";
  } catch {
    // Older Node versions, absent databases and locked/unreadable data are not
    // evidence of expired auth; continue with normal browser autofill.
    return "";
  }
}
