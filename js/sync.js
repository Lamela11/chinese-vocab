// sync.js - keeps your progress the same on every device, through a private repository on your
// GitHub, chinese-vocab-progress. Each device writes only its own files there, one per month
// (devices/<device>/2026-10.json: every answer, star and setting it made) and reads everyone
// else's, so no device can overwrite another's progress. Everything is saved on the device first;
// a sync only adds what's missing, whenever there is a connection.
//
// The key is a GitHub "fine-grained token" that can only read and write that one repository.

const REPO = "chinese-vocab-progress";
const API = "https://api.github.com";
const STUDY_LOG = "devices/study-log/stars.json"; // stars from the study log (local/brain.json)

export class SyncError extends Error {
  // kind: "key" (GitHub won't take the key), "repo" (no such repository), "offline" or "other"
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

// One call to the GitHub API. setup.api is another address for it, used to test with a stand-in.
async function call(setup, method, path, body, okay = [200, 201]) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  let response;
  try {
    response = await fetch((setup.api || API) + path, {
      method,
      headers: { Authorization: `Bearer ${setup.token}`, Accept: "application/vnd.github+json",
        ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body && JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal,
    });
  } catch {
    throw new SyncError("offline", "No connection to GitHub.");
  } finally {
    clearTimeout(timer);
  }
  if (okay.includes(response.status)) return response;
  if (response.status === 401) {
    throw new SyncError("key", "GitHub didn't accept the key. It may be mistyped, expired or deleted.");
  }
  if (response.status === 403 && response.headers.get("x-ratelimit-remaining") !== "0") {
    throw new SyncError("key", `The key can't change ${REPO}. It needs "Contents: Read and write".`);
  }
  if (response.status === 404) {
    throw new SyncError("repo", `Couldn't find ${REPO} on your GitHub, or the key can't open it.`);
  }
  throw new SyncError("other", `GitHub answered ${response.status}. Sync will try again later.`);
}

const repo = (setup) => `/repos/${setup.owner}/${REPO}`;

// Check a key and find the repository it opens: the setup to keep on this device.
export async function connect(token, api) {
  const setup = { token: token.trim(), api };
  if (!/^[\w-]{20,}$/.test(setup.token)) throw new SyncError("key", "That doesn't look like a key: it starts with github_pat_.");
  const user = await (await call(setup, "GET", "/user")).json();
  setup.owner = user.login;
  const info = await (await call(setup, "GET", repo(setup))).json();
  if (!info.private) throw new SyncError("repo", `${REPO} is public. Make it private on GitHub first.`);
  return { ...setup, branch: info.default_branch, seen: {} };
}

// --- File contents ---------------------------------------------------------------------------------

function base64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function unbase64(encoded) {
  const binary = atob(encoded.replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

// The id git gives a file's contents, so an unchanged file isn't sent again.
async function gitId(text) {
  const bytes = new TextEncoder().encode(text);
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const all = new Uint8Array(header.length + bytes.length);
  all.set(header);
  all.set(bytes, header.length);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-1", all));
  return [...hash].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const order = (a, b) => a.t - b.t || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// One event per line, so the files are easy to read on GitHub.
const fileText = (device, events) =>
  `{"device": ${JSON.stringify(device)}, "events": [\n${[...events].sort(order).map((e) => JSON.stringify(e)).join(",\n")}\n]}\n`;

// Every file in the repository and its id. Empty until the first device has synced.
async function files(setup) {
  const response = await call(setup, "GET", `${repo(setup)}/git/trees/${setup.branch}?recursive=1`, undefined, [200, 404, 409]);
  if (response.status !== 200) return new Map();
  const { tree } = await response.json();
  return new Map(tree.filter((f) => f.type === "blob").map((f) => [f.path, f.sha]));
}

// --- A sync -----------------------------------------------------------------------------------------

// Send this device's events (and the study log's stars, on the laptop that has them), then read
// the files other devices changed since the last sync. events: all the events on this device.
// Returns the events read and the new setup.seen (the files read, by id).
export async function sync(setup, device, events, studyLog) {
  let tree = await files(setup);
  const mine = new Map();
  for (const e of events) {
    if (!e.id.startsWith(`${device}-`)) continue;
    const path = `devices/${device}/${new Date(e.t).toISOString().slice(0, 7)}.json`;
    if (!mine.has(path)) mine.set(path, []);
    mine.get(path).push(e);
  }
  if (studyLog.length) mine.set(STUDY_LOG, studyLog);
  for (const [path, list] of mine) {
    const text = fileText(path === STUDY_LOG ? "study-log" : device, list);
    for (let attempt = 1; ; attempt++) {
      if (tree.get(path) === await gitId(text)) break;
      const response = await call(setup, "PUT", `${repo(setup)}/contents/${path}`, {
        message: `Sync ${path}`,
        content: base64(text),
        ...(tree.has(path) ? { sha: tree.get(path) } : {}),
      }, [200, 201, 409, 422]);
      if (response.status < 300) {
        tree.set(path, (await response.json()).content.sha);
        break;
      }
      if (attempt === 3) throw new SyncError("other", "GitHub kept refusing an update. Sync will try again later.");
      tree = await files(setup); // the file changed meanwhile: try again with its new id
    }
  }
  const seen = { ...setup.seen };
  const read = [];
  for (const [path, sha] of tree) {
    if (!/^devices\/[^/]+\/[^/]+\.json$/.test(path) || path.startsWith(`devices/${device}/`) || seen[path] === sha) continue;
    const blob = await (await call(setup, "GET", `${repo(setup)}/git/blobs/${sha}`)).json();
    read.push(...JSON.parse(unbase64(blob.content)).events);
    seen[path] = sha;
  }
  return { read, seen };
}

// The address of the online app, for the phone: this one if it's already online, else the
// GitHub Pages address of the public repository chinese-vocab.
export function onlineAddress(setup) {
  if (location.protocol === "https:") return location.origin + location.pathname;
  return `https://${setup.owner.toLowerCase()}.github.io/chinese-vocab/`;
}
