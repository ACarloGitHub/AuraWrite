// permissions.ts - Agent permission request UI
//
// When an agent tool requests access to a path outside the workspace,
// this module shows a banner in the chat panel and waits for the user
// to approve or deny. The banner is non-blocking: the user can continue
// using the app while the tool waits.

import { invoke } from "@tauri-apps/api/core";

type PermissionScope = "session" | "always";

interface PermissionEntry {
  path: string;
  scope: PermissionScope;
  tool: string;
  granted_at: number;
}

let pendingResolve: ((result: PermissionScope | "deny") => void) | null = null;

export async function requestPermission(
  tool: string,
  path: string
): Promise<boolean> {
  // If the backend check itself throws (e.g. corrupted permission file), we must
  // NOT propagate the error silently — otherwise the banner never shows and the
  // tool just fails. Treat a thrown check as "not authorized" and still ask the user.
  let allowed = false;
  try {
    allowed = await invoke<boolean>("permissions_check", { path, tool });
  } catch (e) {
    console.error("[permissions] check failed, will ask user:", e);
  }
  if (allowed) return true;

  const result = await showPermissionBanner(tool, path);

  if (result === "deny") return false;

  const scope: PermissionScope = result === "always" ? "always" : "session";
  try {
    await invoke("permissions_grant", {
      path,
      scope,
      tool,
    });
  } catch (e) {
    console.error("[permissions] grant failed:", e);
  }

  return true;
}

function showPermissionBanner(
  tool: string,
  path: string
): Promise<PermissionScope | "deny"> {
  return new Promise((resolve) => {
    const banner = document.getElementById("ai-permission-banner");
    const toolEl = document.getElementById("ai-permission-tool");
    const pathEl = document.getElementById("ai-permission-path");
    const denyBtn = document.getElementById("ai-permission-deny");
    const sessionBtn = document.getElementById("ai-permission-session");
    const alwaysBtn = document.getElementById("ai-permission-always");

    if (!banner || !toolEl || !pathEl) {
      resolve("deny");
      return;
    }

    if (pendingResolve) {
      pendingResolve("deny");
      pendingResolve = null;
    }

    toolEl.textContent = `${tool} requests access to:`;
    pathEl.textContent = path;
    banner.style.display = "flex";

    const cleanup = () => {
      banner.style.display = "none";
      pendingResolve = null;
    };

    const onDeny = () => { cleanup(); resolve("deny"); };
    const onSession = () => { cleanup(); resolve("session"); };
    const onAlways = () => { cleanup(); resolve("always"); };

    denyBtn?.removeEventListener("click", onDeny);
    sessionBtn?.removeEventListener("click", onSession);
    alwaysBtn?.removeEventListener("click", onAlways);

    denyBtn?.addEventListener("click", onDeny);
    sessionBtn?.addEventListener("click", onSession);
    alwaysBtn?.addEventListener("click", onAlways);

    pendingResolve = onDeny;
  });
}

export async function listPermissions(): Promise<PermissionEntry[]> {
  try {
    return await invoke<PermissionEntry[]>("permissions_list");
  } catch {
    return [];
  }
}

export async function revokePermission(path: string): Promise<void> {
  await invoke("permissions_revoke", { path });
}

export async function clearSessionPermissions(): Promise<void> {
  await invoke("permissions_clear_session");
}