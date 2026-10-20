// Oberfläche der App: Liste, Filter, Bewertung, Formular, Empfehlung, Einstellungen,
// und mit Supabase-Verbindung zusätzlich Anmeldung, Freunde und Freundesbibliotheken.

import { APP_VERSION, APP_NAME, CATEGORIES, RATING_LABELS, MODELS, DEFAULT_MODEL, MIN_RATED_FOR_RECOMMENDATION } from "./config.js";
import * as store from "./store.js";
import * as cloud from "./cloud.js";
import * as claude from "./claude.js";
import { createCropper } from "./cover.js";

const $ = (id) => document.getElementById(id);
const collator = new Intl.Collator("de", { sensitivity: "base" });
const CLOUD = cloud.enabled();
const INVITE_KEY = "bookstome-invite";
const DEFAULT_LEDE = "Gelesen und für gut befunden. Zu jedem Buch eine kurze Einordnung, eine Kategorie und deine eigene Wertung von einem bis fünf Sternen.";

const state = {
  books: new Map(),
  rec: null,
  libraryName: "",
  apiKey: "",
  model: DEFAULT_MODEL,
  filter: "Alle",
  sort: "inv",
  confirmId: null,
  pendingImport: null,
  // nur mit Konto
  me: null,
  profile: { display_name: "", library_name: "" },
  friends: [],
  view: null, // null = eigene Bibliothek, sonst ID eines Freundes
  friendBooks: new Map(),
  pendingInvite: null,
  invite: null,
  authMode: "in",
  confirmFriend: null,
};
const form = { mode: "add", id: null, rating: 0, newCover: false, removeCover: false };
let cropper = null;
let recCtl = null;
let cpHandler = null;
let persistenceAsked = false;

/* ---------- Hilfsfunktionen ---------- */

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function button(cls, text, onClick, id) {
  const b = el("button", cls, text);
  b.type = "button";
  if (id) b.id = id;
  b.addEventListener("click", onClick);
  return b;
}
const pad = (n) => String(n).padStart(3, "0");
const nBooks = (n) => (n === 1 ? "1 Buch" : n + " Bücher");
const allBooks = () => [...state.books.values()];
const realBooks = () => allBooks().filter((b) => !b.example);
const viewingFriend = () => state.view !== null;
const shownBooks = () => (viewingFriend() ? [...state.friendBooks.values()] : allBooks());
const currentFriend = () => state.friends.find((f) => f.id === state.view) || null;
const friendName = (f) => (f && f.name) || "Ohne Namen";
const possessive = (name) => name + (/[sßxz]$/i.test(name) ? "’" : "s");
const bookKey = (b) => store.normKey(b.author) + "|" + store.normKey(b.title);
const mineByKey = () => new Map(allBooks().map((b) => [bookKey(b), b]));
const errMsg = (e, fallback) => (CLOUD && e && e.message ? e.message : fallback);
function setStatus(t) { $("status").textContent = t; }
function showPanel(id, show) {
  $(id).hidden = !show;
  if (show) $(id).scrollIntoView({ behavior: "smooth", block: "start" });
}
function showNotice(text) {
  $("notice-text").textContent = text;
  $("notice").hidden = !text;
}

/* ---------- Speicher: im Browser oder im Konto ---------- */

const lib = {
  putBook(b) { return lib.putBooks([b]); },
  async putBooks(books) {
    if (!CLOUD) return store.putBooks(books);
    await cloud.saveBooks(books);
    store.cachePut(state.me.id, books).catch(() => {});
  },
  async deleteBook(id) {
    if (!CLOUD) return store.deleteBook(id);
    await cloud.deleteBooks([id]);
    store.cacheDelete(state.me.id, [id]).catch(() => {});
  },
  async clearBooks() {
    if (!CLOUD) return store.clearBooks();
    await cloud.deleteAllBooks();
    store.cacheReplace(state.me.id, []).catch(() => {});
  },
  async setRec(rec) {
    if (!CLOUD) return rec ? store.setSetting("recommendation", rec) : store.deleteSetting("recommendation");
    await cloud.updateProfile({ recommendation: rec || null });
  },
  async setLibraryName(name) {
    if (!CLOUD) return store.setSetting("libraryName", name);
    await cloud.updateProfile({ library_name: name });
    state.profile.library_name = name;
  },
};

/* ---------- Start ---------- */

async function init() {
  $("app-version").textContent = "Version " + APP_VERSION;
  fillSelects();
  cropper = createCropper($("crop-canvas"));
  wireEvents();
  captureInvite();
  try {
    const [key, model, sort, filter] = await Promise.all([
      store.getSetting("apiKey", ""),
      store.getSetting("model", DEFAULT_MODEL),
      store.getSetting("sort", "inv"),
      store.getSetting("filter", "Alle"),
    ]);
    state.apiKey = key || "";
    state.model = MODELS.some((m) => m.id === model) ? model : DEFAULT_MODEL;
    state.sort = sort || "inv";
    state.filter = filter || "Alle";
  } catch (e) {
    if (!CLOUD) {
      $("books").replaceChildren(el("li", "empty", "Diese App braucht den Speicher des Browsers (IndexedDB). In manchen privaten Fenstern ist er gesperrt. Bitte in einem normalen Fenster öffnen."));
      ["add-open", "settings-open"].forEach((id) => { $(id).disabled = true; });
      return;
    }
  }
  $("sort-select").value = state.sort;
  registerServiceWorker();

  if (cloud.configState() === "unsafe") {
    showNotice("In config.js steht ein geheimer Supabase-Schlüssel. Der darf nie in die App. Bitte durch den Publishable key ersetzen. Bis dahin läuft die App ohne Konto.");
  }
  if (!CLOUD) { await loadLocal(); return; }

  applyCloudChrome();
  cloud.onSignedOut(() => showAuth("Bitte melde dich erneut an."));
  const user = cloud.currentUser();
  if (!user) { await showAuth(); return; }
  await startCloud(user);
}

async function loadLocal() {
  try {
    const [list, rec, name] = await Promise.all([
      store.getAllBooks(),
      store.getSetting("recommendation"),
      store.getSetting("libraryName", ""),
    ]);
    list.forEach((b) => state.books.set(b.id, b));
    state.rec = rec && Array.isArray(rec.items) ? rec : null;
    state.libraryName = name || "";
  } catch (e) {
    $("books").replaceChildren(el("li", "empty", "Diese App braucht den Speicher des Browsers (IndexedDB). In manchen privaten Fenstern ist er gesperrt. Bitte in einem normalen Fenster öffnen."));
    return;
  }
  renderAll();
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(() => { /* offline mode is optional */ });
  }
}

function fillSelects() {
  const cat = $("f-category");
  const ph = el("option", null, "Bitte wählen"); ph.value = "";
  cat.appendChild(ph);
  CATEGORIES.forEach((c) => { const o = el("option", null, c); o.value = c; cat.appendChild(o); });
  const model = $("s-model");
  MODELS.forEach((m) => { const o = el("option", null, m.label); o.value = m.id; model.appendChild(o); });
}

/* ---------- Konto ---------- */

function applyCloudChrome() {
  $("friends-open").hidden = false;
  $("tab-friends").hidden = false;
  $("account-group").hidden = false;
  $("f-hidden-field").hidden = false;
  $("wipe-title").textContent = "Alle meine Bücher löschen";
  $("footer-text").textContent = "Deine Bibliothek liegt in deinem " + APP_NAME + "-Konto. Sehen können sie nur Freunde, die du eingeladen hast. Erscheinungsjahr = Erstausgabe im Original. Empfehlungen und ergänzte Rezensionen stammen von Claude.";
  if (navigator.share) $("invite-share").hidden = false;
}

function captureInvite() {
  try {
    const url = new URL(location.href);
    const t = url.searchParams.get("einladung");
    if (t !== null) {
      if (cloud.isValidInviteToken(t)) localStorage.setItem(INVITE_KEY, t);
      url.searchParams.delete("einladung");
      history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
    const stored = localStorage.getItem(INVITE_KEY);
    state.pendingInvite = cloud.isValidInviteToken(stored) ? stored : null;
  } catch (e) { /* ohne localStorage keine Einladung */ }
}
function clearInvite() {
  state.pendingInvite = null;
  try { localStorage.removeItem(INVITE_KEY); } catch (e) { /* ignore */ }
}

async function showAuth(message) {
  state.me = null;
  state.books = new Map();
  state.friends = [];
  state.view = null;
  state.friendBooks = new Map();
  state.rec = null;
  document.body.classList.add("signed-out");
  ["settings-panel", "friends-panel", "form-panel", "cp-panel", "migrate-banner"].forEach((id) => { $(id).hidden = true; });
  $("auth-panel").hidden = false;
  $("eyebrow").textContent = APP_NAME;
  $("lib-name").textContent = "Dein Leseinventar";
  $("lede").textContent = "Bücher erfassen, mit Sternen bewerten, Empfehlungen von Claude bekommen und die Bibliotheken deiner Freunde ansehen.";
  document.title = APP_NAME;
  $("a-status").textContent = message || "";
  setAuthMode(state.pendingInvite ? "up" : "in");
  const card = $("invite-card");
  card.hidden = true;
  if (!state.pendingInvite) return;
  try {
    const info = await cloud.inviteInfo(state.pendingInvite);
    if (info) {
      $("invite-text").textContent = (info.name ? info.name + " lädt dich zu " + APP_NAME + " ein." : "Du wurdest zu " + APP_NAME + " eingeladen.") +
        " Lege ein Konto an. Danach seht ihr gegenseitig eure Bibliotheken, mit Sternen und Kurzrezensionen.";
    } else {
      clearInvite();
      $("invite-text").textContent = "Dieser Einladungslink ist nicht mehr gültig. Hast du schon ein Konto, melde dich einfach an. Sonst bitte um einen neuen Link.";
      setAuthMode("in");
    }
  } catch (e) {
    $("invite-text").textContent = e.message;
  }
  card.hidden = false;
}

function setAuthMode(mode) {
  state.authMode = mode;
  const up = mode === "up";
  $("auth-tab-in").setAttribute("aria-pressed", String(!up));
  $("auth-tab-up").setAttribute("aria-pressed", String(up));
  $("a-name-field").hidden = !up;
  $("a-pass").autocomplete = up ? "new-password" : "current-password";
  $("a-submit").textContent = up ? "Konto erstellen" : "Anmelden";
  $("auth-title").textContent = up ? "Neues Konto" : "Anmelden";
  $("a-hint").hidden = up;
}

async function submitAuth(e) {
  e.preventDefault();
  const status = $("a-status");
  const email = $("a-email").value.trim();
  const pass = $("a-pass").value;
  const name = $("a-name").value.trim();
  const up = state.authMode === "up";
  if (up && !name) { status.textContent = "Bitte deinen Vornamen eintragen. Den sehen deine Freunde."; $("a-name").focus(); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { status.textContent = "Bitte eine gültige E-Mail-Adresse eintragen."; $("a-email").focus(); return; }
  if (up && pass.length < 8) { status.textContent = "Das Passwort braucht mindestens 8 Zeichen."; $("a-pass").focus(); return; }
  if (!pass) { status.textContent = "Bitte dein Passwort eintragen."; $("a-pass").focus(); return; }
  const btn = $("a-submit");
  btn.disabled = true;
  status.textContent = up ? "Konto wird angelegt …" : "Anmelden …";
  try {
    const user = up ? await cloud.signUp(email, pass, name) : await cloud.signIn(email, pass);
    $("a-pass").value = "";
    status.textContent = "";
    await startCloud(user);
  } catch (err) {
    status.textContent = err.message || "Das hat nicht geklappt.";
    if (err.code === "user_already_exists" || err.code === "email_exists") setAuthMode("in");
  } finally {
    btn.disabled = false;
  }
}

async function startCloud(user) {
  state.me = user;
  document.body.classList.remove("signed-out");
  $("auth-panel").hidden = true;
  $("invite-card").hidden = true;
  try {
    const cached = await store.cacheGetAll(user.id);
    if (cached.length) { state.books = new Map(cached.map((b) => [b.id, b])); renderAll(); }
  } catch (e) { /* kein Zwischenspeicher */ }
  if (!state.books.size) $("books").replaceChildren(el("li", "empty", "Bibliothek wird geladen …"));
  try {
    const [profile, books, friends] = await Promise.all([cloud.ensureProfile(""), cloud.listBooks(), cloud.listFriends()]);
    state.profile = { display_name: (profile && profile.display_name) || "", library_name: (profile && profile.library_name) || "" };
    state.libraryName = state.profile.library_name;
    state.rec = profile && profile.recommendation && Array.isArray(profile.recommendation.items) ? profile.recommendation : null;
    const clean = books.map(store.sanitizeBook).filter(Boolean);
    state.books = new Map(clean.map((b) => [b.id, b]));
    state.friends = friends;
    store.cacheReplace(user.id, clean).catch(() => {});
  } catch (e) {
    if (e.code === "session") return;
    showNotice(state.books.size ? "Keine Verbindung zum Server. Du siehst den zuletzt geladenen Stand; Änderungen gehen gerade nicht." : e.message);
  }
  if (!state.me) return;
  renderAll();
  await acceptPendingInvite();
  await checkMigration(false);
}

async function acceptPendingInvite() {
  const token = state.pendingInvite;
  if (!token || !state.me) return;
  try {
    const friend = await cloud.acceptInvite(token);
    clearInvite();
    state.friends = await cloud.listFriends().catch(() => state.friends);
    const name = (friend && friend.name) || "deinem Freund";
    await openFriend(friend.id);
    showNotice("Du und " + name + " seid jetzt verbunden. " + name + " sieht ab jetzt auch deine Bibliothek.");
  } catch (e) {
    if (e.code === "network" || e.code === "session") return;
    clearInvite();
    showNotice(e.message);
  }
}

async function signOut() {
  const uid = state.me && state.me.id;
  await cloud.signOut();
  if (uid) store.cacheReplace(uid, []).catch(() => {});
  $("a-email").value = "";
  await showAuth("Du bist abgemeldet.");
}

function resetDeleteAccount() {
  $("account-delete-actions").replaceChildren(button("link-btn danger", "Konto löschen", askDeleteAccount, "s-delete-account"));
}
function askDeleteAccount() {
  $("account-delete-actions").replaceChildren(
    el("span", "note warn", "Konto mit allen Büchern, Sternen und Freundschaften endgültig löschen? Exportiere vorher, wenn du die Bücher behalten willst."),
    button("btn danger", "Ja, Konto löschen", deleteAccount, "s-delete-yes"),
    button("link-btn", "Abbrechen", resetDeleteAccount, "s-delete-no"),
  );
  $("s-delete-no").focus();
}
async function deleteAccount() {
  const uid = state.me && state.me.id;
  try {
    await cloud.deleteAccount();
    if (uid) { store.cacheReplace(uid, []).catch(() => {}); store.deleteSetting("migrated-" + uid).catch(() => {}); }
    resetDeleteAccount();
    await showAuth("Dein Konto ist gelöscht.");
  } catch (e) {
    $("s-account-status").textContent = errMsg(e, "Das Löschen hat nicht geklappt.");
  }
}

async function saveDisplayName() {
  const name = $("s-display").value.trim().slice(0, 60);
  if (!name) { $("s-account-status").textContent = "Bitte einen Namen eintragen."; return; }
  try {
    await cloud.updateProfile({ display_name: name });
    state.profile.display_name = name;
    $("s-account-status").textContent = "Gespeichert.";
    renderHeader();
  } catch (e) { $("s-account-status").textContent = errMsg(e, "Speichern hat nicht geklappt."); }
}

/* ---------- Bücher von diesem Gerät ins Konto übernehmen ---------- */

async function localBooks() {
  try { return (await store.getAllBooks()).filter((b) => !b.example); } catch (e) { return []; }
}

async function checkMigration(force) {
  if (!state.me) return;
  const local = await localBooks();
  $("s-migrate").hidden = !local.length;
  if (!local.length) return;
  const { toWrite } = store.mergeBooks(allBooks(), local);
  const seen = await store.getSetting("migrated-" + state.me.id, null).catch(() => null);
  if (!toWrite.length || (seen && !force)) {
    if (force) showNotice("Alle Bücher von diesem Gerät sind schon in deinem Konto.");
    return;
  }
  $("migrate-text").textContent = allBooks().length
    ? "Auf diesem Gerät liegen " + nBooks(toWrite.length) + ", die in deinem Konto noch fehlen oder hier neuer sind. Übernehmen?"
    : "Auf diesem Gerät liegen " + nBooks(local.length) + " aus der Zeit vor deinem Konto. Sollen sie in dein Konto? Deine Sterne bleiben erhalten.";
  $("migrate-banner").hidden = false;
  if (force) $("migrate-banner").scrollIntoView({ behavior: "smooth", block: "center" });
}

async function migrate() {
  const btn = $("migrate-yes");
  btn.disabled = true; btn.textContent = "Wird übernommen …";
  try {
    const local = await localBooks();
    const { toWrite, added, updated } = store.mergeBooks(allBooks(), local);
    await lib.putBooks(toWrite);
    toWrite.forEach((b) => state.books.set(b.id, b));
    if (!state.rec) {
      const r = await store.getSetting("recommendation").catch(() => null);
      if (r && Array.isArray(r.items)) { state.rec = r; await lib.setRec(r); }
    }
    if (!state.libraryName) {
      const n = await store.getSetting("libraryName", "").catch(() => "");
      if (n) { await lib.setLibraryName(n); state.libraryName = n; }
    }
    await store.setSetting("migrated-" + state.me.id, new Date().toISOString());
    $("migrate-banner").hidden = true;
    state.view = null;
    renderAll();
    showNotice(nBooks(added) + " übernommen" + (updated ? ", " + updated + " aktualisiert" : "") + ". Deine Bibliothek liegt jetzt in deinem Konto.");
  } catch (e) {
    showNotice(errMsg(e, "Die Übernahme hat nicht geklappt."));
  } finally {
    btn.disabled = false; btn.textContent = "In mein Konto übernehmen";
  }
}

async function dismissMigration() {
  $("migrate-banner").hidden = true;
  if (state.me) await store.setSetting("migrated-" + state.me.id, "später").catch(() => {});
  showNotice("Du kannst die Bücher jederzeit unter „Einstellungen und Daten“ übernehmen.");
}

/* ---------- Freunde ---------- */

function closePanels() {
  ["settings-panel", "friends-panel", "form-panel", "cp-panel"].forEach((id) => { $(id).hidden = true; });
  $("add-open").disabled = false;
}

async function openFriend(id) {
  closePanels();
  state.view = id;
  state.friendBooks = new Map();
  state.filter = "Alle";
  state.confirmId = null;
  renderAll();
  $("books").replaceChildren(el("li", "empty", "Bibliothek wird geladen …"));
  window.scrollTo({ top: 0, behavior: "smooth" });
  try {
    const books = (await cloud.listBooks(id)).map(store.sanitizeBook).filter(Boolean);
    if (state.view !== id) return;
    state.friendBooks = new Map(books.map((b) => [b.id, b]));
  } catch (e) {
    if (state.view === id) showNotice(e.message);
  }
  if (state.view === id) renderAll();
}

function showMine() {
  state.view = null;
  state.friendBooks = new Map();
  state.filter = "Alle";
  renderAll();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function openFriends(keepOpen) {
  if (!$("friends-panel").hidden) {
    if (keepOpen === true) { $("friends-panel").scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    $("friends-panel").hidden = true;
    return;
  }
  state.confirmFriend = null;
  renderFriendList();
  showPanel("friends-panel", true);
  prepareInvite(false);
  try {
    state.friends = await cloud.listFriends();
    renderFriendList();
    renderHeader();
  } catch (e) { /* Liste vom Start bleibt */ }
}

function inviteLink(token) { return location.origin + location.pathname + "?einladung=" + token; }
function inviteMessage(link) {
  return "Hallo! Ich sammle meine gelesenen Bücher in " + APP_NAME + ", mit Sternen und kurzen Rezensionen. Über diesen Link siehst du meine Bibliothek und kannst deine eigene anlegen: " + link;
}
function setInviteReady(ok) {
  const a = $("invite-wa");
  a.setAttribute("aria-disabled", String(!ok));
  a.classList.toggle("disabled", !ok);
  $("invite-copy").disabled = !ok;
  $("invite-share").disabled = !ok;
}

async function prepareInvite(quiet) {
  setInviteReady(false);
  state.invite = null;
  if (!quiet) $("invite-status").textContent = "Einladungslink wird vorbereitet …";
  try {
    const token = await cloud.createInvite();
    const link = inviteLink(token);
    state.invite = { token, link, message: inviteMessage(link) };
    $("invite-wa").href = "https://wa.me/?text=" + encodeURIComponent(state.invite.message);
    setInviteReady(true);
    if (!quiet) $("invite-status").textContent = "";
  } catch (e) {
    $("invite-status").textContent = e.message;
  }
}

function inviteSent(text) {
  $("invite-status").textContent = text;
  setTimeout(() => prepareInvite(true), 400);
}

function onInviteWhatsApp(e) {
  if (!state.invite) { e.preventDefault(); return; }
  inviteSent("WhatsApp ist geöffnet. Wähle dort die Person aus. Für die nächste Einladung gibt es automatisch einen neuen Link.");
}

async function onInviteCopy() {
  if (!state.invite) return;
  try {
    await navigator.clipboard.writeText(state.invite.message);
    inviteSent("Einladung kopiert. Füge sie in eine Nachricht an die Person ein.");
  } catch (e) {
    $("invite-status").textContent = "Kopieren ging nicht. Hier ist der Link: " + state.invite.link;
    setTimeout(() => prepareInvite(true), 400);
  }
}

async function onInviteShare() {
  if (!state.invite || !navigator.share) return;
  try {
    await navigator.share({ title: APP_NAME, text: state.invite.message });
    inviteSent("Einladung geteilt. Für die nächste Person gibt es einen neuen Link.");
  } catch (e) { /* abgebrochen */ }
}

function renderFriendList() {
  const ul = $("friend-list");
  $("friend-count").textContent = state.friends.length ? "Deine Freunde (" + state.friends.length + ")" : "Deine Freunde";
  if (!state.friends.length) {
    ul.replaceChildren(el("li", "friend none", "Noch niemand. Schick deinen ersten Einladungslink, zum Beispiel per WhatsApp."));
    return;
  }
  ul.replaceChildren(...state.friends.map((f) => {
    const li = el("li", "friend");
    const info = el("div", "friend-info");
    info.append(el("strong", null, friendName(f)), el("span", "note", nBooks(Number(f.books) || 0) + (f.library ? " · " + f.library : "")));
    const acts = el("div", "actions");
    if (state.confirmFriend === f.id) {
      acts.append(
        el("span", "note warn", "Verbindung mit " + friendName(f) + " beenden? Ihr seht eure Bibliotheken dann nicht mehr."),
        button("link-btn danger", "Ja, beenden", () => doRemoveFriend(f), "unfriend-yes-" + f.id),
        button("link-btn", "Abbrechen", () => { state.confirmFriend = null; renderFriendList(); }),
      );
    } else {
      acts.append(
        button("btn quiet", "Bibliothek ansehen", () => openFriend(f.id), "friend-open-" + f.id),
        button("link-btn", "Entfernen", () => { state.confirmFriend = f.id; renderFriendList(); }, "unfriend-" + f.id),
      );
    }
    li.append(info, acts);
    return li;
  }));
}

async function doRemoveFriend(f) {
  try {
    await cloud.removeFriend(f.id);
    state.friends = state.friends.filter((x) => x.id !== f.id);
    state.confirmFriend = null;
    if (state.view === f.id) state.view = null;
    renderFriendList();
    renderAll();
    $("invite-status").textContent = "Verbindung mit " + friendName(f) + " beendet.";
  } catch (e) {
    $("invite-status").textContent = e.message;
  }
}

async function adoptBook(fb) {
  if (mineByKey().has(bookKey(fb))) return;
  const btn = $("adopt-" + fb.id);
  if (btn) btn.disabled = true;
  const now = new Date().toISOString();
  const book = store.sanitizeBook({
    ...fb, id: store.makeId(fb.author, fb.title), inv: nextInv(), rating: 0, edition: "",
    hidden: false, example: false, createdAt: now, updatedAt: now,
  });
  try {
    await lib.putBook(book);
    state.books.set(book.id, book);
    refreshMineSlot(fb.id, true);
    setStatus("„" + fb.title + "“ steht jetzt in deiner Bibliothek. Vergib gleich deine Sterne.");
  } catch (e) {
    setStatus(errMsg(e, "Übernehmen hat nicht geklappt."));
    if (btn) btn.disabled = false;
  }
}

/* ---------- Rendern ---------- */

function renderAll() {
  renderHeader();
  renderExampleBanner();
  renderRecs();
  renderChips();
  renderList();
  renderEditionList();
}

function renderHeader() {
  const fv = viewingFriend();
  if (fv) {
    const f = currentFriend();
    const name = friendName(f);
    const title = (f && f.library) || possessive(name) + " Bibliothek";
    $("eyebrow").textContent = "Bibliothek von " + name;
    $("lib-name").textContent = title;
    const common = state.friendBooks.size ? [...state.friendBooks.values()].filter((b) => mineByKey().has(bookKey(b))).length : 0;
    $("lede").textContent = (common === 1 ? "Ein Buch habt ihr beide gelesen. " : common > 1 ? common + " Bücher habt ihr beide gelesen. " : "") +
      "Hast du ein Buch auch gelesen, tippe auf „Auch gelesen“. Dann steht es in deiner Bibliothek und du kannst es selbst bewerten.";
    document.title = title + " · " + APP_NAME;
  } else {
    const own = CLOUD && state.profile.display_name ? possessive(state.profile.display_name) + " Bibliothek" : "Meine Bibliothek";
    const name = state.libraryName || own;
    $("eyebrow").textContent = CLOUD ? APP_NAME + " · Privates Leseinventar" : "Privates Leseinventar";
    $("lib-name").textContent = name;
    $("lede").textContent = DEFAULT_LEDE;
    document.title = name;
  }
  $("add-open").hidden = fv;
  $("settings-open").hidden = fv;
  $("back-mine").hidden = !fv;
  $("friends-open").hidden = !CLOUD || fv;
  if (CLOUD) $("friends-open").textContent = state.friends.length ? "Freunde (" + state.friends.length + ")" : "Freunde einladen";
  $("tab-lib").setAttribute("aria-current", String(!fv));
  $("tab-friends").setAttribute("aria-current", String(fv));
  const ratingOpt = $("sort-select").querySelector('option[value="rating"]');
  if (ratingOpt) ratingOpt.textContent = fv ? "Bewertung" : "Meine Bewertung";
  renderShelves();
  renderStats();
}

function renderShelves() {
  const nav = $("shelves");
  const show = CLOUD && !!state.me;
  nav.hidden = !show;
  if (!show) return;
  const items = [{ id: null, label: state.friends.length ? "Meine" : "Meine Bibliothek" }, ...state.friends.map((f) => ({ id: f.id, label: friendName(f) }))];
  const add = button("shelf-add", "+", () => openFriends(true), "shelf-add");
  add.setAttribute("aria-label", "Freund einladen");
  nav.replaceChildren(...items.map((it) => {
    const b = button("chip", it.label, () => (it.id ? openFriend(it.id) : showMine()), it.id ? "shelf-" + it.id : "shelf-mine");
    b.setAttribute("aria-pressed", String(state.view === it.id));
    return b;
  }), add);
}

function renderStats() {
  const books = shownBooks();
  const vals = books.map((b) => b.rating).filter(Boolean);
  $("stat-count").textContent = String(books.length);
  $("stat-rated").textContent = books.length ? vals.length + " / " + books.length : "–";
  $("stat-avg").textContent = vals.length
    ? (vals.reduce((s, v) => s + v, 0) / vals.length).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    : "–";
  $("stat-fav").textContent = books.length ? String(books.filter((b) => b.rating === 5).length) : "–";
}

function renderExampleBanner() {
  $("example-banner").hidden = viewingFriend() || !allBooks().some((b) => b.example);
}

function renderChips() {
  const books = shownBooks();
  $("toolbar").hidden = !books.length;
  const counts = { Alle: books.length };
  books.forEach((b) => { counts[b.category] = (counts[b.category] || 0) + 1; });
  if (state.filter !== "Alle" && !counts[state.filter]) state.filter = "Alle";
  const names = ["Alle", ...CATEGORIES.filter((c) => counts[c])];
  $("chips").replaceChildren(...names.map((name) => {
    const b = button("chip", null, () => {
      state.filter = name;
      if (!viewingFriend()) store.setSetting("filter", name).catch(() => {});
      state.confirmId = null;
      renderChips(); renderList();
    }, "chip-" + store.normKey(name));
    b.setAttribute("aria-pressed", state.filter === name ? "true" : "false");
    b.append(el("span", null, name), el("span", "n", String(counts[name] || 0)));
    return b;
  }));
}

function sortedVisible() {
  const arr = shownBooks().filter((b) => state.filter === "Alle" || b.category === state.filter);
  arr.sort((a, b) => {
    switch (state.sort) {
      case "author": return collator.compare(a.sortAuthor, b.sortAuthor) || (a.year || 0) - (b.year || 0);
      case "title": return collator.compare(a.title, b.title);
      case "year-asc": return (a.year || 9999) - (b.year || 9999) || collator.compare(a.title, b.title);
      case "year-desc": return (b.year || 0) - (a.year || 0) || collator.compare(a.title, b.title);
      case "rating": return (b.rating || 0) - (a.rating || 0) || collator.compare(a.sortAuthor, b.sortAuthor);
      default: return a.inv - b.inv;
    }
  });
  return arr;
}

function renderList() {
  const list = $("books");
  if (viewingFriend()) {
    if (!state.friendBooks.size) {
      const li = el("li", "empty");
      li.append(el("strong", null, friendName(currentFriend()) + " hat noch keine Bücher eingetragen."), el("span", null, "Sobald Bücher dazukommen, siehst du sie hier."));
      list.replaceChildren(li);
      return;
    }
  } else if (!state.books.size) {
    const li = el("li", "empty");
    const actions = el("div", "actions");
    if (CLOUD) {
      li.append(
        el("strong", null, "Deine Bibliothek ist noch leer."),
        el("span", null, state.friends.length
          ? "Lege dein erstes Buch an oder sieh dir die Bibliothek deiner Freunde an und übernimm, was du auch gelesen hast."
          : "Lege dein erstes Buch an, hole eine gesicherte Bibliothek zurück oder lade Freunde ein."),
      );
      actions.append(button("btn", "Erstes Buch hinzufügen", () => openForm("add")));
      if (state.friends.length) {
        const f = state.friends[0];
        actions.append(button("btn quiet", "Bibliothek von " + friendName(f) + " ansehen", () => openFriend(f.id)));
      } else {
        actions.append(button("btn quiet", "Freunde einladen", () => openFriends(true)));
      }
      actions.append(button("btn quiet", "Bibliothek importieren", () => $("s-import").click()));
    } else {
      li.append(
        el("strong", null, "Deine Bibliothek ist noch leer."),
        el("span", null, "Lege dein erstes Buch an, hole eine gesicherte Bibliothek zurück oder sieh dir die App mit ein paar Beispielbüchern an."),
      );
      actions.append(
        button("btn", "Erstes Buch hinzufügen", () => openForm("add")),
        button("btn quiet", "Bibliothek importieren", () => $("s-import").click()),
        button("btn quiet", "Beispiele ansehen", loadExamples, "load-examples"),
      );
    }
    li.append(actions);
    list.replaceChildren(li);
    return;
  }
  const arr = sortedVisible();
  if (!arr.length) { list.replaceChildren(el("li", "empty", "In der Kategorie „" + state.filter + "“ steht noch kein Buch.")); return; }
  list.replaceChildren(...arr.map(viewingFriend() ? buildFriendRow : buildRow));
}

function typeCover(b) {
  const t = el("div", "cover cover-type");
  t.setAttribute("role", "img");
  t.setAttribute("aria-label", "Schrift-Cover: " + b.title);
  t.append(el("span", "ct-author", b.sortAuthor || b.author), el("span", "ct-title", b.title));
  return t;
}

/** Gemeinsamer Aufbau einer Buchzeile: Cover, Kopf, Rezension. */
function buildBookBase(b, own) {
  const li = el("li", "book");
  const coverCell = el("div", "cover-cell");
  if (b.cover) {
    const img = el("img", "cover");
    img.src = b.cover; img.alt = "Cover: " + b.title; img.width = 200; img.height = 300; img.decoding = "async"; img.loading = "lazy";
    coverCell.append(img);
  } else {
    coverCell.append(typeCover(b));
  }
  if (b.rating === 5) {
    const ear = el("span", "ear");
    ear.title = "Eselsohr: Lieblingsbuch mit 5 Sternen";
    coverCell.append(ear);
  }
  li.append(coverCell);

  const head = el("div", "head");
  head.append(el("h2", "title", b.title), el("div", "byline author", b.author));
  if (b.subtitle) head.append(el("div", "subtitle", b.subtitle));
  const meta = el("div", "meta");
  meta.append(el("span", "cat", b.category));
  if (b.year) meta.append(el("span", "year", String(b.year)));
  if (b.lang) meta.append(el("span", null, b.lang));
  if (b.edition) meta.append(el("span", null, "Ausgabe: " + b.edition));
  if (b.award) meta.append(el("span", "tag", b.award));
  if (b.example) meta.append(el("span", "tag example", "Beispiel"));
  if (own && CLOUD && b.hidden) meta.append(el("span", "tag private", "Nur für dich"));
  meta.append(el("span", "inv", "Inv. " + pad(b.inv)));
  head.append(meta);
  li.append(head);

  const text = el("div", "text");
  if (b.review) text.append(el("p", "review", b.review));
  li.append(text);
  return { li, text };
}

function buildRow(b) {
  const { li, text } = buildBookBase(b, true);
  li.id = "buch-" + b.id;
  const slot = el("div", "rating-slot");
  slot.append(buildRating(b));
  text.append(slot, buildRowActions(b));
  return li;
}

function readOnlyStars(n) {
  const box = el("span", "ro-stars");
  box.setAttribute("role", "img");
  box.setAttribute("aria-label", n ? n + " von 5 Sternen" : "nicht bewertet");
  for (let i = 1; i <= 5; i++) {
    const s = el("span", "ro-star" + (i <= n ? " on" : ""));
    s.innerHTML = '<svg aria-hidden="true"><use href="#star"></use></svg>';
    box.append(s);
  }
  return box;
}

function buildFriendRow(fb) {
  const { li, text } = buildBookBase(fb, false);
  li.id = "freund-" + fb.id;
  const name = friendName(currentFriend());
  const theirs = el("div", "rating ro");
  theirs.append(
    readOnlyStars(fb.rating),
    el("span", "rating-label" + (fb.rating ? " set" : ""), fb.rating ? possessive(name) + " Wertung: " + RATING_LABELS[fb.rating] : "Von " + name + " noch nicht bewertet"),
  );
  const slot = el("div", "mine-slot");
  slot.id = "mine-" + fb.id;
  text.append(theirs, slot);
  fillMineSlot(slot, fb);
  return li;
}

function fillMineSlot(slot, fb) {
  const mine = mineByKey().get(bookKey(fb));
  if (mine) {
    const box = el("div", "mine");
    box.append(
      el("span", "mine-label", "In deiner Bibliothek · deine Wertung"),
      buildStars(mine.rating, "my-" + fb.id, "Deine Bewertung für " + fb.title, (n) => setRating(mine.id, n)),
    );
    slot.replaceChildren(box);
  } else {
    slot.replaceChildren(button("btn quiet small", "Auch gelesen", () => adoptBook(fb), "adopt-" + fb.id));
  }
}

function refreshMineSlot(fbId, focusStars) {
  const slot = $("mine-" + fbId), fb = state.friendBooks.get(fbId);
  if (!slot || !fb) return;
  const focusId = slot.contains(document.activeElement) ? document.activeElement.id : null;
  fillMineSlot(slot, fb);
  const f = (focusId && $(focusId)) || (focusStars ? $("my-" + fbId + "-1") : null);
  if (f) f.focus();
}

function buildStars(current, idPrefix, label, onPick) {
  const stars = el("div", "stars");
  stars.setAttribute("role", "group");
  stars.setAttribute("aria-label", label);
  for (let i = 1; i <= 5; i++) {
    const btn = button("star" + (i <= current ? " on" : ""), null, () => onPick(i), idPrefix + "-" + i);
    btn.setAttribute("aria-label", i + (i === 1 ? " Stern" : " Sterne") + " – " + RATING_LABELS[i]);
    btn.setAttribute("aria-pressed", i === current ? "true" : "false");
    btn.innerHTML = '<svg aria-hidden="true"><use href="#star"></use></svg>';
    stars.append(btn);
  }
  return stars;
}

function buildRating(b) {
  const box = el("div", "rating");
  box.append(
    buildStars(b.rating, "star-" + b.id, "Bewertung für " + b.title, (n) => setRating(b.id, n)),
    el("span", "rating-label" + (b.rating ? " set" : ""), RATING_LABELS[b.rating]),
  );
  if (b.rating) box.append(button("link-btn", "Zurücksetzen", () => setRating(b.id, 0), "clear-" + b.id));
  return box;
}

function buildRowActions(b) {
  const box = el("div", "row-actions");
  if (state.confirmId === b.id) {
    box.append(
      el("span", "confirm-text", "„" + b.title + "“ wirklich entfernen?"),
      button("link-btn danger", "Ja, entfernen", () => removeBook(b.id), "del-yes-" + b.id),
      button("link-btn", "Abbrechen", () => { state.confirmId = null; renderList(); }, "del-no-" + b.id),
    );
  } else {
    box.append(
      button("link-btn", "Bearbeiten", () => openForm("edit", b), "edit-" + b.id),
      button("link-btn", "Entfernen", () => {
        state.confirmId = b.id; renderList();
        const f = $("del-no-" + b.id); if (f) f.focus();
      }, "del-" + b.id),
    );
  }
  return box;
}

function renderRating(id) {
  const li = $("buch-" + id), b = state.books.get(id);
  if (!li || !b) return;
  const slot = li.querySelector(".rating-slot");
  const focusId = slot.contains(document.activeElement) ? document.activeElement.id : null;
  slot.replaceChildren(buildRating(b));
  if (focusId) { const f = $(focusId) || $("star-" + id + "-1"); if (f) f.focus(); }
}

function renderEditionList() {
  const editions = [...new Set(allBooks().map((b) => b.edition).filter(Boolean))].sort(collator.compare);
  $("edition-list").replaceChildren(...editions.map((e) => { const o = el("option"); o.value = e; return o; }));
}

/* ---------- Bewertung ---------- */

async function setRating(id, n) {
  const b = state.books.get(id);
  if (!b) return;
  b.rating = b.rating === n ? 0 : n;
  b.updatedAt = new Date().toISOString();
  if (viewingFriend()) {
    const fb = [...state.friendBooks.values()].find((x) => bookKey(x) === bookKey(b));
    if (fb) refreshMineSlot(fb.id, false);
  } else {
    renderRating(id); renderStats(); renderRecs();
  }
  try { await lib.putBook(b); setStatus("Gespeichert"); }
  catch (e) { setStatus(errMsg(e, "Speichern hat nicht geklappt. Ist der Speicher des Browsers voll?")); }
}

/* ---------- Empfehlung ---------- */

function recPool() {
  const real = realBooks();
  return real.length ? real : allBooks();
}
function basisKey() {
  return recPool().filter((b) => b.rating).sort((a, b) => (a.id < b.id ? -1 : 1)).map((b) => b.id + ":" + b.rating).join(",");
}
function ownedTitleKeys() { return new Set(allBooks().map((b) => claude.normTitle(b.title))); }

function renderRecs() {
  const section = $("recs");
  const pool = recPool();
  section.hidden = !pool.length || viewingFriend();
  if (section.hidden) return;
  const rated = pool.filter((b) => b.rating).length;
  const rec = state.rec;
  const sub = $("recs-sub"), list = $("rec-list"), note = $("rec-note");

  if (!rec || !rec.items || !rec.items.length) {
    sub.textContent = rated >= MIN_RATED_FOR_RECOMMENDATION
      ? "Claude schlägt dir auf Basis deiner Sterne drei Bücher vor."
      : "Bewerte mindestens " + MIN_RATED_FOR_RECOMMENDATION + " Bücher, dann schlägt Claude dir passende nächste Bücher vor.";
    list.replaceChildren();
  } else {
    const when = rec.createdAt ? new Date(rec.createdAt) : null;
    sub.textContent = "Drei Vorschläge auf Basis von " + (rec.ratedCount || rated) + " Bewertungen" +
      (when && !isNaN(when) ? " · " + when.toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" }) : "");
    const owned = ownedTitleKeys();
    list.replaceChildren(...rec.items.slice(0, 3).map((it) => {
      const li = el("li", "rec");
      if (it.label) li.append(el("span", "tag", it.label));
      li.append(el("h3", "rec-title", it.title));
      li.append(el("div", "rec-by", [it.author, it.year, it.category].filter(Boolean).join(" · ")));
      if (it.reason) li.append(el("p", "rec-reason", it.reason));
      if (it.basedOn && it.basedOn.length) li.append(el("div", "rec-basis", "Weil dir gefiel: " + it.basedOn.join(", ")));
      if (owned.has(claude.normTitle(it.title))) li.append(el("div", "rec-basis", "Steht schon in deiner Bibliothek."));
      else li.append(button("link-btn accent", "Gelesen? Ins Inventar übernehmen", () => openForm("add", {
        author: it.author, title: it.title, year: it.year, category: it.category,
      })));
      return li;
    }));
  }
  if (!recCtl) {
    const stale = rec && rec.basisKey && rec.basisKey !== basisKey();
    note.hidden = !stale;
    if (stale) { note.className = "note warn"; note.textContent = "Deine Bewertungen haben sich seit dieser Empfehlung geändert. „Neue Empfehlung“ berücksichtigt den aktuellen Stand."; }
  }
}

async function newRecommendation() {
  const pool = recPool();
  const rated = pool.filter((b) => b.rating).length;
  const note = $("rec-note");
  if (rated < MIN_RATED_FOR_RECOMMENDATION) {
    note.hidden = false; note.className = "note warn";
    note.textContent = "Bewerte mindestens " + MIN_RATED_FOR_RECOMMENDATION + " Bücher, damit die Empfehlung eine Grundlage hat.";
    return;
  }
  const history = state.rec && Array.isArray(state.rec.history) ? state.rec.history : [];
  const prompt = claude.recommendationPrompt(pool, history);
  if (!state.apiKey) {
    openCp("Empfehlung von Claude holen", prompt, (data) => applyRecommendation(claude.normalizeRecommendation(data, ownedTitleKeys()), "claude.ai"));
    return;
  }
  recCtl = new AbortController();
  const btn = $("rec-new");
  btn.disabled = true; btn.textContent = "Claude überlegt …";
  $("rec-stop").hidden = false;
  note.hidden = false; note.className = "note";
  note.textContent = "Claude liest deine Bewertungen und sucht drei passende Bücher. Das dauert meist unter einer Minute.";
  try {
    const text = await claude.callClaude({ apiKey: state.apiKey, model: state.model, prompt, maxTokens: 2000, signal: recCtl.signal });
    await applyRecommendation(claude.normalizeRecommendation(claude.parseAnswer(text), ownedTitleKeys()), "api");
    note.hidden = true;
  } catch (e) {
    note.hidden = e.code === "cancelled";
    note.className = "note warn";
    note.textContent = e.message || "Das hat nicht geklappt. Bitte noch einmal versuchen.";
  } finally {
    recCtl = null;
    btn.disabled = false; btn.textContent = "Neue Empfehlung";
    $("rec-stop").hidden = true;
    renderRecs();
  }
}

async function applyRecommendation(items, source) {
  const pool = recPool();
  const history = (state.rec && Array.isArray(state.rec.history) ? state.rec.history : [])
    .concat(items.map((i) => i.author + " – " + i.title)).slice(-30);
  state.rec = {
    items, history, source,
    createdAt: new Date().toISOString(),
    basisKey: basisKey(),
    ratedCount: pool.filter((b) => b.rating).length,
  };
  renderRecs();
  try { await lib.setRec(state.rec); setStatus("Neue Empfehlung gespeichert."); }
  catch (e) { setStatus(errMsg(e, "Die Empfehlung ließ sich nicht speichern.")); }
  $("recs").scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------- Claude ohne Schlüssel: Kopieren und Einfügen ---------- */

function openCp(title, prompt, handler) {
  $("cp-title").textContent = title;
  $("cp-prompt").value = prompt;
  $("cp-answer").value = "";
  $("cp-status").textContent = "";
  $("cp-copy-status").textContent = "";
  cpHandler = handler;
  showPanel("cp-panel", true);
}
function closeCp() { $("cp-panel").hidden = true; cpHandler = null; }

async function copyPrompt() {
  const ta = $("cp-prompt");
  try {
    await navigator.clipboard.writeText(ta.value);
    $("cp-copy-status").textContent = "Kopiert. Jetzt in Claude einfügen.";
  } catch (e) {
    ta.focus(); ta.select();
    $("cp-copy-status").textContent = "Der Text ist markiert. Bitte mit Kopieren übernehmen.";
  }
}

async function applyCp() {
  const status = $("cp-status");
  if (!cpHandler) return;
  try {
    const data = claude.parseAnswer($("cp-answer").value);
    await cpHandler(data);
    closeCp();
  } catch (e) {
    status.textContent = e.message || "Die Antwort ließ sich nicht übernehmen.";
  }
}

/* ---------- Formular ---------- */

function renderFormStars() {
  const wrap = el("div", "rating");
  wrap.append(
    buildStars(form.rating, "f-star", "Deine Bewertung", (n) => {
      form.rating = form.rating === n ? 0 : n;
      renderFormStars();
      const f = $("f-star-" + n); if (f) f.focus();
    }),
    el("span", "rating-label" + (form.rating ? " set" : ""), RATING_LABELS[form.rating]),
  );
  $("f-rating").replaceChildren(wrap);
}

function openForm(mode, b = {}) {
  form.mode = mode;
  form.id = mode === "edit" ? b.id : null;
  form.rating = mode === "edit" ? b.rating || 0 : 0;
  form.newCover = false;
  form.removeCover = false;
  $("form-title").textContent = mode === "edit" ? "Buch bearbeiten" : "Buch hinzufügen";
  $("f-author").value = b.author || "";
  $("f-title").value = b.title || "";
  $("f-category").value = b.category || "";
  $("f-year").value = b.year || "";
  $("f-lang").value = b.lang || "";
  $("f-edition").value = b.edition || "";
  $("f-subtitle").value = b.subtitle || "";
  $("f-award").value = b.award || "";
  $("f-review").value = b.review || "";
  $("f-hidden").checked = mode === "edit" && !!b.hidden;
  $("f-status").textContent = "";
  $("f-cover").value = "";
  resetCoverEditor(mode === "edit" ? b : null);
  renderFormStars();
  $("add-open").disabled = true;
  showPanel("form-panel", true);
  setTimeout(() => (b.author ? $("f-category") : $("f-author")).focus({ preventScroll: true }), 300);
}

function closeForm() {
  $("form-panel").hidden = true;
  $("add-open").disabled = false;
  cropper.clear();
}

function resetCoverEditor(existing) {
  cropper.clear();
  $("crop-canvas").hidden = true;
  $("zoom-field").hidden = true;
  const ph = $("crop-placeholder");
  ph.hidden = false;
  if (existing && existing.cover) {
    const img = el("img", "cover"); img.src = existing.cover; img.alt = "Aktuelles Cover";
    ph.replaceChildren(img);
    $("f-cover-remove").hidden = false;
    $("f-cover-note").textContent = "Neues Foto wählen, um das Cover zu ersetzen.";
  } else {
    ph.replaceChildren(typeCover({ author: "Autor", sortAuthor: "Autor", title: "Titel" }));
    $("f-cover-remove").hidden = true;
    $("f-cover-note").textContent = "Ohne Foto bekommt das Buch ein schlichtes Schrift-Cover.";
  }
}

async function onCoverChosen(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    await cropper.load(file);
  } catch (err) {
    $("f-status").textContent = err.message;
    return;
  }
  $("f-zoom").value = String(cropper.zoom);
  $("crop-placeholder").hidden = true;
  $("crop-canvas").hidden = false;
  $("zoom-field").hidden = false;
  $("f-cover-remove").hidden = false;
  $("f-cover-note").textContent = "Ziehe das Foto im Rahmen zurecht.";
  form.newCover = true;
  form.removeCover = false;
}

function removeCover() {
  form.newCover = false;
  form.removeCover = true;
  $("f-cover").value = "";
  resetCoverEditor(null);
  $("f-cover-note").textContent = "Das Buch bekommt ein schlichtes Schrift-Cover.";
}

function nextInv() { return allBooks().reduce((m, b) => Math.max(m, b.inv || 0), 0) + 1; }

async function saveForm(e) {
  e.preventDefault();
  const fs = $("f-status");
  const author = $("f-author").value.trim(), title = $("f-title").value.trim();
  if (!author || !title) { fs.textContent = "Bitte Autor und Titel ausfüllen."; (author ? $("f-title") : $("f-author")).focus(); return; }
  const yearRaw = $("f-year").value.trim();
  const year = yearRaw ? Number(yearRaw) : null;
  if (yearRaw && (!Number.isFinite(year) || year < 1 || year > 2100)) { fs.textContent = "Das Erscheinungsjahr sieht nicht richtig aus."; $("f-year").focus(); return; }
  if (form.mode === "add") {
    const dupe = allBooks().find((b) => store.normKey(b.title) === store.normKey(title) && store.normKey(b.author) === store.normKey(author));
    if (dupe) { fs.textContent = "Dieses Buch steht schon in deiner Bibliothek (Inv. " + pad(dupe.inv) + ")."; return; }
  }
  const prev = form.mode === "edit" ? state.books.get(form.id) : null;
  const now = new Date().toISOString();
  let cover = null;
  if (form.newCover && cropper.loaded) cover = cropper.toDataUrl();
  else if (!form.removeCover && prev) cover = prev.cover;
  const parts = author.split(/\s+/);
  const book = store.sanitizeBook({
    id: prev ? prev.id : store.makeId(author, title),
    inv: prev ? prev.inv : nextInv(),
    author,
    sortAuthor: prev && prev.author === author ? prev.sortAuthor : parts[parts.length - 1],
    title,
    subtitle: $("f-subtitle").value,
    year,
    category: $("f-category").value || "Sonstiges",
    lang: $("f-lang").value,
    edition: $("f-edition").value,
    award: $("f-award").value,
    review: $("f-review").value,
    rating: form.rating,
    cover,
    example: prev ? prev.example : false,
    hidden: CLOUD && $("f-hidden").checked,
    createdAt: prev ? prev.createdAt : now,
    updatedAt: now,
  });
  $("f-save").disabled = true;
  try {
    await lib.putBook(book);
    state.books.set(book.id, book);
    if (!persistenceAsked && !CLOUD) { persistenceAsked = true; store.requestPersistence(); }
    closeForm();
    if (state.filter !== "Alle" && state.filter !== book.category) state.filter = "Alle";
    renderAll();
    setStatus("„" + title + "“ " + (form.mode === "edit" ? "aktualisiert." : "hinzugefügt."));
    const row = $("buch-" + book.id);
    if (row) row.scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (err) {
    fs.textContent = errMsg(err, "Speichern hat nicht geklappt. Ist der Speicher des Browsers voll?");
  } finally {
    $("f-save").disabled = false;
  }
}

async function removeBook(id) {
  const b = state.books.get(id);
  if (!b) return;
  try {
    await lib.deleteBook(id);
    state.books.delete(id);
    state.confirmId = null;
    renderAll();
    setStatus("„" + b.title + "“ entfernt.");
  } catch (e) { setStatus(errMsg(e, "Entfernen hat nicht geklappt.")); }
}

/* Claude ergänzt leere Felder */
async function assist() {
  const author = $("f-author").value.trim(), title = $("f-title").value.trim();
  const fs = $("f-status");
  if (!author || !title) { fs.textContent = "Bitte zuerst Autor und Titel eintragen."; return; }
  const prompt = claude.fillPrompt(author, title);
  if (!state.apiKey) {
    openCp("Buchangaben von Claude ergänzen", prompt, (data) => {
      applyFill(claude.normalizeFill(data));
      $("form-panel").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return;
  }
  const btn = $("f-assist");
  btn.disabled = true; btn.textContent = "Claude ergänzt …"; fs.textContent = "";
  try {
    const text = await claude.callClaude({ apiKey: state.apiKey, model: state.model, prompt, maxTokens: 800 });
    applyFill(claude.normalizeFill(claude.parseAnswer(text)));
  } catch (e) {
    fs.textContent = e.message || "Das hat nicht geklappt. Bitte selbst ausfüllen.";
  } finally {
    btn.disabled = false; btn.textContent = "Mit Claude ergänzen";
  }
}

function applyFill(f) {
  const filled = [];
  if (!$("f-year").value && f.year) { $("f-year").value = f.year; filled.push("Jahr"); }
  if (!$("f-category").value && f.category) { $("f-category").value = f.category; filled.push("Kategorie"); }
  if (!$("f-lang").value && f.lang) { $("f-lang").value = f.lang; filled.push("Sprache"); }
  if (!$("f-subtitle").value && f.subtitle) { $("f-subtitle").value = f.subtitle; filled.push("Untertitel"); }
  if (!$("f-review").value && f.review) { $("f-review").value = f.review; filled.push("Kurzrezension"); }
  $("f-status").textContent = filled.length ? "Ergänzt: " + filled.join(", ") + ". Bitte kurz prüfen." : "Alle Felder waren schon ausgefüllt.";
}

/* ---------- Beispiele (nur ohne Konto) ---------- */

async function loadExamples() {
  try {
    const res = await fetch("beispiel-bibliothek.json");
    const data = store.parseImport(await res.text());
    const books = data.books.map((b) => ({ ...b, example: true }));
    await store.putBooks(books);
    books.forEach((b) => state.books.set(b.id, b));
    renderAll();
    setStatus("Beispielbücher geladen.");
  } catch (e) {
    setStatus("Die Beispiele ließen sich nicht laden.");
  }
}

async function removeExamples() {
  const ex = allBooks().filter((b) => b.example);
  for (const b of ex) { await lib.deleteBook(b.id); state.books.delete(b.id); }
  if (state.rec && state.rec.source === "beispiel") state.rec = null;
  renderAll();
  setStatus("Beispiele entfernt.");
}

/* ---------- Einstellungen, Export, Import ---------- */

function openSettings() {
  $("s-name").value = state.libraryName;
  $("s-key").value = state.apiKey;
  $("s-model").value = state.model;
  $("s-key-status").textContent = state.apiKey ? "Ein Schlüssel ist hinterlegt." : "";
  $("s-data-status").textContent = "";
  $("import-choice").hidden = true;
  resetWipe();
  if (CLOUD && state.me) {
    $("s-account").textContent = "Angemeldet als " + (state.profile.display_name || "–") + " (" + state.me.email + ").";
    $("s-display").value = state.profile.display_name;
    $("s-account-status").textContent = "";
    resetDeleteAccount();
    $("s-backup-note").textContent = "Deine Bibliothek liegt in deinem Konto und ist auf jedem Gerät da, auf dem du dich anmeldest. Zusätzlich kannst du sie als Datei sichern.";
    localBooks().then((l) => { $("s-migrate").hidden = !l.length; $("s-migrate").textContent = "Bücher von diesem Gerät übernehmen (" + l.length + ")"; });
  } else {
    store.getSetting("lastExport").then((d) => {
      $("s-backup-note").textContent = "Deine Bibliothek liegt nur in diesem Browser. Exportiere sie regelmäßig als Datei, um sie zu sichern oder auf ein anderes Gerät zu bringen." +
        (d ? " Letzter Export: " + new Date(d).toLocaleDateString("de-DE") + "." : " Bisher noch kein Export.");
    }).catch(() => {});
  }
  showPanel("settings-panel", true);
}

async function saveName() {
  const name = $("s-name").value.trim().slice(0, 80);
  try {
    await lib.setLibraryName(name);
    state.libraryName = name;
    renderHeader();
  } catch (e) { $("s-data-status").textContent = errMsg(e, "Speichern hat nicht geklappt."); }
}

async function saveKey() {
  const key = $("s-key").value.trim();
  state.apiKey = key;
  state.model = $("s-model").value || DEFAULT_MODEL;
  if (key) await store.setSetting("apiKey", key); else await store.deleteSetting("apiKey");
  await store.setSetting("model", state.model);
  $("s-key-status").textContent = !key ? "Kein Schlüssel hinterlegt. Claude läuft über Kopieren und Einfügen."
    : key.startsWith("sk-ant-") ? "Gespeichert." : "Gespeichert. Hinweis: Claude-Schlüssel beginnen normalerweise mit sk-ant-.";
}

async function removeKey() {
  state.apiKey = "";
  $("s-key").value = "";
  await store.deleteSetting("apiKey");
  $("s-key-status").textContent = "Schlüssel entfernt.";
}

async function exportLibrary() {
  const real = realBooks();
  const st = $("s-data-status");
  if (!real.length) { st.textContent = "Es gibt noch keine eigenen Bücher zum Exportieren."; return; }
  const data = store.buildExport(real, state.rec, state.libraryName);
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: "application/json" });
  const date = new Date().toISOString().slice(0, 10);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "bibliothek-" + date + ".json";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  await store.setSetting("lastExport", new Date().toISOString()).catch(() => {});
  st.textContent = nBooks(real.length) + " exportiert.";
}

async function onImportChosen(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const st = $("s-data-status");
  if ($("settings-panel").hidden) openSettings();
  let data;
  try { data = store.parseImport(await file.text()); }
  catch (err) { st.textContent = err.message; return; }
  state.pendingImport = data;
  if (!realBooks().length) { await doImport("replace"); return; }
  $("import-choice-text").textContent = "Deine Bibliothek hat " + nBooks(realBooks().length) + ", die Datei enthält " + nBooks(data.books.length) +
    ". Zusammenführen ergänzt fehlende Bücher, Ersetzen löscht deine jetzige Bibliothek.";
  $("import-choice").hidden = false;
  $("import-merge").focus();
}

async function doImport(mode) {
  const data = state.pendingImport;
  const st = $("s-data-status");
  if (!data) return;
  $("import-choice").hidden = true;
  st.textContent = "Wird importiert …";
  try {
    if (mode === "replace") {
      await lib.clearBooks();
      await lib.putBooks(data.books);
      state.books = new Map(data.books.map((b) => [b.id, b]));
      state.rec = data.recommendation;
      await lib.setRec(state.rec);
      if (data.libraryName && !state.libraryName) { state.libraryName = data.libraryName; await lib.setLibraryName(state.libraryName); }
      st.textContent = nBooks(data.books.length) + " importiert.";
    } else {
      const { toWrite, added, updated } = store.mergeBooks(allBooks(), data.books);
      await lib.putBooks(toWrite);
      toWrite.forEach((b) => state.books.set(b.id, b));
      if (!state.rec && data.recommendation) { state.rec = data.recommendation; await lib.setRec(state.rec); }
      st.textContent = nBooks(added) + " ergänzt, " + updated + " aktualisiert.";
    }
    if (!persistenceAsked && !CLOUD) { persistenceAsked = true; store.requestPersistence(); }
    renderAll();
    $("s-name").value = state.libraryName;
  } catch (err) {
    st.textContent = errMsg(err, "Der Import hat nicht geklappt. Ist der Speicher des Browsers voll?");
  } finally {
    state.pendingImport = null;
  }
}

function resetWipe() {
  const box = $("wipe-actions");
  box.replaceChildren(button("btn danger", CLOUD ? "Alle meine Bücher löschen" : "Alle Bücher und Einstellungen löschen", askWipe, "s-wipe"));
}
function askWipe() {
  const box = $("wipe-actions");
  box.replaceChildren(
    el("span", "note warn", "Wirklich alles löschen? Das lässt sich nicht rückgängig machen. Exportiere vorher, wenn du die Bücher behalten willst."),
    button("btn danger", "Ja, alles löschen", wipe, "s-wipe-yes"),
    button("link-btn", "Abbrechen", resetWipe, "s-wipe-no"),
  );
  $("s-wipe-no").focus();
}
async function wipe() {
  try {
    await lib.clearBooks();
    await lib.setRec(null);
  } catch (e) { $("s-data-status").textContent = errMsg(e, "Löschen hat nicht geklappt."); return; }
  const keys = CLOUD ? ["recommendation", "sort", "filter", "lastExport"] : ["recommendation", "libraryName", "apiKey", "model", "sort", "filter", "lastExport"];
  for (const k of keys) await store.deleteSetting(k).catch(() => {});
  state.books = new Map(); state.rec = null; state.filter = "Alle"; state.sort = "inv"; $("sort-select").value = "inv";
  if (!CLOUD) { state.libraryName = ""; state.apiKey = ""; state.model = DEFAULT_MODEL; }
  resetWipe();
  $("settings-panel").hidden = true;
  renderAll();
  setStatus("Alles gelöscht.");
}

/* ---------- Leiste unten (Handy) ---------- */

function tabLibrary() {
  if (viewingFriend()) { showMine(); return; }
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function tabRecs() {
  if (viewingFriend()) showMine();
  if ($("recs").hidden) { showNotice("Lege zuerst ein paar Bücher an und bewerte sie. Dann schlägt Claude dir passende nächste Bücher vor."); return; }
  $("recs").scrollIntoView({ behavior: "smooth", block: "start" });
}
function tabAdd() {
  if (viewingFriend()) showMine();
  if ($("form-panel").hidden) openForm("add"); else $("form-panel").scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------- Ereignisse ---------- */

function wireEvents() {
  $("add-open").addEventListener("click", () => openForm("add"));
  $("settings-open").addEventListener("click", () => ($("settings-panel").hidden ? openSettings() : ($("settings-panel").hidden = true)));
  $("settings-close").addEventListener("click", () => { $("settings-panel").hidden = true; });
  $("examples-remove").addEventListener("click", removeExamples);
  $("notice-close").addEventListener("click", () => showNotice(""));

  $("sort-select").addEventListener("change", (e) => {
    state.sort = e.target.value;
    store.setSetting("sort", state.sort).catch(() => {});
    renderList();
  });

  $("rec-new").addEventListener("click", newRecommendation);
  $("rec-stop").addEventListener("click", () => { if (recCtl) recCtl.abort(); });

  $("cp-copy").addEventListener("click", copyPrompt);
  $("cp-apply").addEventListener("click", applyCp);
  $("cp-close").addEventListener("click", closeCp);

  $("book-form").addEventListener("submit", saveForm);
  $("f-cancel").addEventListener("click", closeForm);
  $("f-assist").addEventListener("click", assist);
  $("f-cover").addEventListener("change", onCoverChosen);
  $("f-zoom").addEventListener("input", (e) => cropper.setZoom(Number(e.target.value) || 1));
  $("f-cover-remove").addEventListener("click", removeCover);

  $("s-name").addEventListener("change", saveName);
  $("s-key-save").addEventListener("click", saveKey);
  $("s-key-remove").addEventListener("click", removeKey);
  $("s-model").addEventListener("change", async () => { state.model = $("s-model").value; await store.setSetting("model", state.model); });
  $("s-export").addEventListener("click", exportLibrary);
  $("s-import").addEventListener("change", onImportChosen);
  $("import-merge").addEventListener("click", () => doImport("merge"));
  $("import-replace").addEventListener("click", () => doImport("replace"));
  $("import-cancel").addEventListener("click", () => { state.pendingImport = null; $("import-choice").hidden = true; });

  // Konto und Freunde
  $("auth-form").addEventListener("submit", submitAuth);
  $("auth-tab-in").addEventListener("click", () => { setAuthMode("in"); $("a-status").textContent = ""; });
  $("auth-tab-up").addEventListener("click", () => { setAuthMode("up"); $("a-status").textContent = ""; });
  $("s-signout").addEventListener("click", signOut);
  $("s-display").addEventListener("change", saveDisplayName);
  $("s-migrate").addEventListener("click", () => { $("settings-panel").hidden = true; checkMigration(true); });
  $("migrate-yes").addEventListener("click", migrate);
  $("migrate-no").addEventListener("click", dismissMigration);
  $("friends-open").addEventListener("click", () => openFriends(false));
  $("tab-lib").addEventListener("click", tabLibrary);
  $("tab-friends").addEventListener("click", () => openFriends(true));
  $("tab-recs").addEventListener("click", tabRecs);
  $("tab-add").addEventListener("click", tabAdd);
  $("friends-close").addEventListener("click", () => { $("friends-panel").hidden = true; });
  $("back-mine").addEventListener("click", showMine);
  $("invite-wa").addEventListener("click", onInviteWhatsApp);
  $("invite-copy").addEventListener("click", onInviteCopy);
  $("invite-share").addEventListener("click", onInviteShare);
}

init();
