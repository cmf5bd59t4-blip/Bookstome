// Speicherung im Browser (IndexedDB) sowie Export und Import.
// Ohne Supabase-Verbindung liegt die Bibliothek nur hier. Mit Verbindung (cloud.js) dient
// IndexedDB zusätzlich als Zwischenspeicher, damit die App sofort und auch offline startet.

import { CATEGORIES, FORMAT, FORMAT_VERSION } from "./config.js";

const DB_NAME = "meine-bibliothek";
const DB_VERSION = 1;
const dbPromises = new Map();

function openDb(name = DB_NAME) {
  if (dbPromises.has(name)) return dbPromises.get(name);
  const promise = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) { reject(new Error("no-indexeddb")); return; }
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("books")) db.createObjectStore("books", { keyPath: "id" });
      if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("blocked"));
  });
  dbPromises.set(name, promise);
  promise.catch(() => dbPromises.delete(name));
  return promise;
}

function tx(storeName, mode, run, dbName = DB_NAME) {
  return openDb(dbName).then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const store = t.objectStore(storeName);
    let result;
    Promise.resolve(run(store)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error("aborted"));
  }));
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/* ---------- Bücher ---------- */

export function getAllBooks() {
  return tx("books", "readonly", (s) => reqToPromise(s.getAll()))
    .then((list) => (list || []).map(sanitizeBook).filter(Boolean));
}
export function putBook(book) { return tx("books", "readwrite", (s) => { s.put(book); }); }
export function putBooks(books) { return tx("books", "readwrite", (s) => { books.forEach((b) => s.put(b)); }); }
export function deleteBook(id) { return tx("books", "readwrite", (s) => { s.delete(id); }); }
export function clearBooks() { return tx("books", "readwrite", (s) => { s.clear(); }); }

/* ---------- Zwischenspeicher für die Cloud-Bibliothek (je Konto) ---------- */

const cacheDb = (uid) => "bookstome-cache-" + String(uid).replace(/[^a-z0-9-]/gi, "");
export function cacheGetAll(uid) {
  return tx("books", "readonly", (s) => reqToPromise(s.getAll()), cacheDb(uid))
    .then((list) => (list || []).map(sanitizeBook).filter(Boolean));
}
export function cacheReplace(uid, books) {
  return tx("books", "readwrite", (s) => { s.clear(); books.forEach((b) => s.put(b)); }, cacheDb(uid));
}
export function cachePut(uid, books) { return tx("books", "readwrite", (s) => { books.forEach((b) => s.put(b)); }, cacheDb(uid)); }
export function cacheDelete(uid, ids) { return tx("books", "readwrite", (s) => { ids.forEach((id) => s.delete(id)); }, cacheDb(uid)); }

/* ---------- Einstellungen ---------- */

export function getSetting(key, fallback = null) {
  return tx("settings", "readonly", (s) => reqToPromise(s.get(key)))
    .then((v) => (v === undefined ? fallback : v));
}
export function setSetting(key, value) { return tx("settings", "readwrite", (s) => { s.put(value, key); }); }
export function deleteSetting(key) { return tx("settings", "readwrite", (s) => { s.delete(key); }); }

/** Bittet den Browser, die Daten nicht automatisch zu löschen (wirkt nicht überall). */
export function requestPersistence() {
  try { if (navigator.storage && navigator.storage.persist) return navigator.storage.persist(); } catch (e) { /* ignore */ }
  return Promise.resolve(false);
}

/* ---------- Datenmodell ---------- */

const str = (v, max = 2000) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const COVER_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

/** Prüft und normalisiert einen Bucheintrag (aus Speicher, Formular oder Import). */
export function sanitizeBook(raw) {
  if (!raw || typeof raw !== "object") return null;
  const title = str(raw.title, 300);
  const author = str(raw.author, 200);
  if (!title || !author) return null;
  const year = Number(raw.year);
  const rating = Number(raw.rating);
  const parts = author.split(/\s+/);
  const cover = typeof raw.cover === "string" && raw.cover.length < 1500000 && COVER_RE.test(raw.cover) ? raw.cover : null;
  return {
    id: str(raw.id, 120) || makeId(author, title),
    inv: Number.isFinite(Number(raw.inv)) && Number(raw.inv) > 0 ? Math.round(Number(raw.inv)) : 0,
    author,
    sortAuthor: str(raw.sortAuthor, 200) || parts[parts.length - 1],
    title,
    subtitle: str(raw.subtitle, 300),
    year: Number.isFinite(year) && year >= 1 && year <= 2100 ? Math.round(year) : null,
    category: CATEGORIES.includes(raw.category) ? raw.category : "Sonstiges",
    lang: str(raw.lang, 80),
    edition: str(raw.edition, 120),
    award: str(raw.award, 120),
    review: str(raw.review, 3000),
    rating: Number.isFinite(rating) && rating >= 1 && rating <= 5 ? Math.round(rating) : 0,
    cover,
    example: raw.example === true,
    hidden: raw.hidden === true,
    createdAt: str(raw.createdAt, 40) || new Date().toISOString(),
    updatedAt: str(raw.updatedAt, 40) || str(raw.createdAt, 40) || new Date().toISOString(),
  };
}

export function normKey(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "");
}

export function makeId(author, title) {
  const parts = String(author).split(/\s+/);
  const last = normKey(parts[parts.length - 1]).slice(0, 20) || "autor";
  return last + "-" + (normKey(title).slice(0, 30) || "buch") + "-" + Math.random().toString(36).slice(2, 6);
}

/* ---------- Export / Import ---------- */

export function buildExport(books, recommendation, libraryName) {
  return {
    format: FORMAT,
    version: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    libraryName: libraryName || "",
    books: books.filter((b) => !b.example),
    recommendation: recommendation || null,
  };
}

/** Liest eine Export-Datei. Wirft einen Fehler mit verständlicher Meldung, wenn sie nicht passt. */
export function parseImport(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error("Die Datei ist kein gültiges JSON."); }
  if (!data || data.format !== FORMAT || !Array.isArray(data.books)) {
    throw new Error("Das ist keine Export-Datei dieser App.");
  }
  if (Number(data.version) > FORMAT_VERSION) {
    throw new Error("Die Datei stammt aus einer neueren Version der App. Bitte die App aktualisieren.");
  }
  const books = data.books.map((b) => sanitizeBook({ ...b, example: false })).filter(Boolean);
  if (!books.length) throw new Error("In der Datei stehen keine Bücher.");
  return {
    books,
    recommendation: data.recommendation && Array.isArray(data.recommendation.items) ? data.recommendation : null,
    libraryName: str(data.libraryName, 80),
  };
}

/**
 * Führt importierte Bücher mit vorhandenen zusammen.
 * Gleiche Bücher (gleiche ID oder gleicher Autor + Titel) werden durch die jüngere Fassung ersetzt.
 */
export function mergeBooks(existing, incoming) {
  const byId = new Map(existing.map((b) => [b.id, b]));
  const byKey = new Map(existing.map((b) => [normKey(b.author) + "|" + normKey(b.title), b]));
  const usedInv = new Set(existing.map((b) => b.inv).filter(Boolean));
  let nextInv = Math.max(0, ...existing.map((b) => b.inv || 0), ...incoming.map((b) => b.inv || 0));
  const result = [];
  let added = 0, updated = 0;
  for (const b of [...incoming].sort((x, y) => (x.inv || 0) - (y.inv || 0))) {
    const match = byId.get(b.id) || byKey.get(normKey(b.author) + "|" + normKey(b.title));
    if (match) {
      if ((b.updatedAt || "") > (match.updatedAt || "")) {
        result.push({ ...b, id: match.id, inv: match.inv });
        updated++;
      }
    } else {
      // Inventarnummer behalten, wenn sie frei ist, sonst hinten anfügen.
      const inv = b.inv && !usedInv.has(b.inv) ? b.inv : ++nextInv;
      usedInv.add(inv);
      result.push({ ...b, id: byId.has(b.id) ? makeId(b.author, b.title) : b.id, inv });
      added++;
    }
  }
  return { toWrite: result, added, updated };
}
