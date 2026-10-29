// store.js - everything is saved on this device first, in IndexedDB: the log of answers, stars and
// settings ("events"), the word lists last downloaded ("units") and a few values such as this
// device's id ("kv"). If the browser offers no IndexedDB (some private windows), it keeps them in
// memory for this visit only.

const DB_NAME = "shengci";
let opening = null;
const memory = { events: new Map(), units: new Map(), kv: new Map() };

function open() {
  opening ||= new Promise((resolve) => {
    let request;
    try {
      request = indexedDB.open(DB_NAME, 1);
    } catch {
      return resolve(null);
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore("events", { keyPath: "id" });
      db.createObjectStore("units", { keyPath: "unit" });
      db.createObjectStore("kv");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
  return opening;
}

export async function persistent() {
  return !!(await open());
}

async function run(name, mode, work) {
  const db = await open();
  if (!db) return work(null)?.result;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, mode);
    const request = work(tx.objectStore(name));
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

export function getAll(name) {
  return run(name, "readonly", (s) => (s ? s.getAll() : { result: [...memory[name].values()] }));
}

export function get(name, key) {
  return run(name, "readonly", (s) => (s ? s.get(key) : { result: memory[name].get(key) }));
}

export function put(name, value, key) {
  return run(name, "readwrite", (s) => {
    if (s) return key === undefined ? s.put(value) : s.put(value, key);
    memory[name].set(key ?? value.id ?? value.unit, value);
  });
}

export function remove(name, key) {
  return run(name, "readwrite", (s) => (s ? s.delete(key) : memory[name].delete(key)));
}

let device = null;
let counter = 0;

export async function deviceId() {
  device ||= (await get("kv", "device")) || null;
  if (!device) {
    device = Math.random().toString(36).slice(2, 8);
    await put("kv", device, "device");
    navigator.storage?.persist?.(); // ask the browser not to clear the app's data
  }
  return device;
}

// Save one event (an answer, a star, a setting...) and return it with its id and time.
export async function record(fields) {
  const id = await deviceId();
  const t = Date.now();
  const event = { id: `${id}-${t.toString(36)}-${(counter++).toString(36)}`, t, ...fields };
  await put("events", event);
  return event;
}
