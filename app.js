// Oberfläche der App: Liste, Filter, Bewertung, Formular, Empfehlung, Einstellungen.

import { APP_VERSION, CATEGORIES, RATING_LABELS, MODELS, DEFAULT_MODEL, MIN_RATED_FOR_RECOMMENDATION } from "./config.js";
import * as store from "./store.js";
import * as claude from "./claude.js";
import { createCropper } from "./cover.js";

const $ = (id) => document.getElementById(id);
const collator = new Intl.Collator("de", { sensitivity: "base" });

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
function setStatus(t) { $("status").textContent = t; }
function showPanel(id, show) {
  $(id).hidden = !show;
  if (show) $(id).scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------- Start ---------- */

async function init() {
  $("app-version").textContent = "Version " + APP_VERSION;
  fillSelects();
  cropper = createCropper($("crop-canvas"));
  wireEvents();
  try {
    const [list, rec, name, key, model, sort, filter] = await Promise.all([
      store.getAllBooks(),
      store.getSetting("recommendation"),
      store.getSetting("libraryName", ""),
      store.getSetting("apiKey", ""),
      store.getSetting("model", DEFAULT_MODEL),
      store.getSetting("sort", "inv"),
      store.getSetting("filter", "Alle"),
    ]);
    list.forEach((b) => state.books.set(b.id, b));
    state.rec = rec && Array.isArray(rec.items) ? rec : null;
    state.libraryName = name || "";
    state.apiKey = key || "";
    state.model = MODELS.some((m) => m.id === model) ? model : DEFAULT_MODEL;
    state.sort = sort || "inv";
    state.filter = filter || "Alle";
  } catch (e) {
    $("books").replaceChildren(el("li", "empty", "Diese App braucht den Speicher des Browsers (IndexedDB). In manchen privaten Fenstern ist er gesperrt. Bitte in einem normalen Fenster öffnen."));
    ["add-open", "settings-open"].forEach((id) => { $(id).disabled = true; });
    return;
  }
  $("sort-select").value = state.sort;
  renderAll();
  registerServiceWorker();
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
  const name = state.libraryName || "Meine Bibliothek";
  $("lib-name").textContent = name;
  document.title = name;
  renderStats();
}

function renderStats() {
  const books = allBooks();
  const vals = books.map((b) => b.rating).filter(Boolean);
  $("stat-count").textContent = String(books.length);
  $("stat-rated").textContent = books.length ? vals.length + " / " + books.length : "–";
  $("stat-avg").textContent = vals.length
    ? (vals.reduce((s, v) => s + v, 0) / vals.length).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    : "–";
  const years = books.map((b) => b.year).filter(Boolean);
  $("stat-span").textContent = years.length ? Math.min(...years) + "–" + Math.max(...years) : "–";
}

function renderExampleBanner() {
  $("example-banner").hidden = !allBooks().some((b) => b.example);
}

function renderChips() {
  const books = allBooks();
  $("toolbar").hidden = !books.length;
  const counts = { Alle: books.length };
  books.forEach((b) => { counts[b.category] = (counts[b.category] || 0) + 1; });
  if (state.filter !== "Alle" && !counts[state.filter]) state.filter = "Alle";
  const names = ["Alle", ...CATEGORIES.filter((c) => counts[c])];
  $("chips").replaceChildren(...names.map((name) => {
    const b = button("chip", null, () => {
      state.filter = name;
      store.setSetting("filter", name).catch(() => {});
      state.confirmId = null;
      renderChips(); renderList();
    }, "chip-" + store.normKey(name));
    b.setAttribute("aria-pressed", state.filter === name ? "true" : "false");
    b.append(el("span", null, name), el("span", "n", String(counts[name] || 0)));
    return b;
  }));
}

function sortedVisible() {
  const arr = allBooks().filter((b) => state.filter === "Alle" || b.category === state.filter);
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
  if (!state.books.size) {
    const li = el("li", "empty");
    li.append(
      el("strong", null, "Deine Bibliothek ist noch leer."),
      el("span", null, "Lege dein erstes Buch an, hole eine gesicherte Bibliothek zurück oder sieh dir die App mit ein paar Beispielbüchern an."),
    );
    const actions = el("div", "actions");
    actions.append(
      button("btn", "Erstes Buch hinzufügen", () => openForm("add")),
      button("btn quiet", "Bibliothek importieren", () => $("s-import").click()),
      button("btn quiet", "Beispiele ansehen", loadExamples, "load-examples"),
    );
    li.append(actions);
    list.replaceChildren(li);
    return;
  }
  const arr = sortedVisible();
  if (!arr.length) { list.replaceChildren(el("li", "empty", "In der Kategorie „" + state.filter + "“ steht noch kein Buch.")); return; }
  list.replaceChildren(...arr.map(buildRow));
}

function typeCover(b) {
  const t = el("div", "cover cover-type");
  t.setAttribute("role", "img");
  t.setAttribute("aria-label", "Schrift-Cover: " + b.title);
  t.append(el("span", "ct-author", b.sortAuthor || b.author), el("span", "ct-title", b.title));
  return t;
}

function buildRow(b) {
  const li = el("li", "book");
  li.id = "buch-" + b.id;

  const coverCell = el("div", "cover-cell");
  if (b.cover) {
    const img = el("img", "cover");
    img.src = b.cover; img.alt = "Cover: " + b.title; img.width = 200; img.height = 300; img.decoding = "async";
    coverCell.append(img);
  } else {
    coverCell.append(typeCover(b));
  }
  li.append(coverCell);

  const head = el("div", "head");
  const top = el("div", "topline");
  top.append(el("span", "author", b.author), el("span", "inv", "Inv. " + pad(b.inv)));
  head.append(top, el("h2", "title", b.title));
  if (b.subtitle) head.append(el("div", "subtitle", b.subtitle));
  const meta = el("div", "meta");
  meta.append(el("span", "cat", b.category));
  if (b.year) meta.append(el("span", "year", String(b.year)));
  if (b.lang) meta.append(el("span", null, b.lang));
  if (b.edition) meta.append(el("span", null, "Ausgabe: " + b.edition));
  if (b.award) meta.append(el("span", "tag", b.award));
  if (b.example) meta.append(el("span", "tag example", "Beispiel"));
  head.append(meta);
  li.append(head);

  const text = el("div", "text");
  if (b.review) text.append(el("p", "review", b.review));
  const slot = el("div", "rating-slot");
  slot.append(buildRating(b));
  text.append(slot, buildRowActions(b));
  li.append(text);
  return li;
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
  renderRating(id); renderStats(); renderRecs();
  try { await store.putBook(b); setStatus("Gespeichert"); }
  catch (e) { setStatus("Speichern hat nicht geklappt. Ist der Speicher des Browsers voll?"); }
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
  section.hidden = !pool.length;
  if (!pool.length) return;
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
  await store.setSetting("recommendation", state.rec);
  renderRecs();
  setStatus("Neue Empfehlung gespeichert.");
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
    createdAt: prev ? prev.createdAt : now,
    updatedAt: now,
  });
  $("f-save").disabled = true;
  try {
    await store.putBook(book);
    state.books.set(book.id, book);
    if (!persistenceAsked) { persistenceAsked = true; store.requestPersistence(); }
    closeForm();
    if (state.filter !== "Alle" && state.filter !== book.category) state.filter = "Alle";
    renderAll();
    setStatus("„" + title + "“ " + (form.mode === "edit" ? "aktualisiert." : "hinzugefügt."));
    const row = $("buch-" + book.id);
    if (row) row.scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (err) {
    fs.textContent = "Speichern hat nicht geklappt. Ist der Speicher des Browsers voll?";
  } finally {
    $("f-save").disabled = false;
  }
}

async function removeBook(id) {
  const b = state.books.get(id);
  if (!b) return;
  try {
    await store.deleteBook(id);
    state.books.delete(id);
    state.confirmId = null;
    renderAll();
    setStatus("„" + b.title + "“ entfernt.");
  } catch (e) { setStatus("Entfernen hat nicht geklappt."); }
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

/* ---------- Beispiele ---------- */

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
  for (const b of ex) { await store.deleteBook(b.id); state.books.delete(b.id); }
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
  store.getSetting("lastExport").then((d) => {
    $("s-backup-note").textContent = "Deine Bibliothek liegt nur in diesem Browser. Exportiere sie regelmäßig als Datei, um sie zu sichern oder auf ein anderes Gerät zu bringen." +
      (d ? " Letzter Export: " + new Date(d).toLocaleDateString("de-DE") + "." : " Bisher noch kein Export.");
  }).catch(() => {});
  showPanel("settings-panel", true);
}

async function saveName() {
  state.libraryName = $("s-name").value.trim().slice(0, 80);
  await store.setSetting("libraryName", state.libraryName);
  renderHeader();
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
  await store.setSetting("lastExport", new Date().toISOString());
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
  try {
    if (mode === "replace") {
      await store.clearBooks();
      await store.putBooks(data.books);
      state.books = new Map(data.books.map((b) => [b.id, b]));
      state.rec = data.recommendation;
      if (state.rec) await store.setSetting("recommendation", state.rec); else await store.deleteSetting("recommendation");
      if (data.libraryName && !state.libraryName) { state.libraryName = data.libraryName; await store.setSetting("libraryName", state.libraryName); }
      st.textContent = nBooks(data.books.length) + " importiert.";
    } else {
      const { toWrite, added, updated } = store.mergeBooks(allBooks(), data.books);
      await store.putBooks(toWrite);
      toWrite.forEach((b) => state.books.set(b.id, b));
      if (!state.rec && data.recommendation) { state.rec = data.recommendation; await store.setSetting("recommendation", state.rec); }
      st.textContent = nBooks(added) + " ergänzt, " + updated + " aktualisiert.";
    }
    if (!persistenceAsked) { persistenceAsked = true; store.requestPersistence(); }
    renderAll();
    $("s-name").value = state.libraryName;
  } catch (err) {
    st.textContent = "Der Import hat nicht geklappt. Ist der Speicher des Browsers voll?";
  } finally {
    state.pendingImport = null;
  }
}

function resetWipe() {
  const box = $("wipe-actions");
  box.replaceChildren(button("btn danger", "Alle Bücher und Einstellungen löschen", askWipe, "s-wipe"));
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
  await store.clearBooks();
  for (const k of ["recommendation", "libraryName", "apiKey", "model", "sort", "filter", "lastExport"]) await store.deleteSetting(k);
  state.books = new Map(); state.rec = null; state.libraryName = ""; state.apiKey = ""; state.model = DEFAULT_MODEL;
  state.filter = "Alle"; state.sort = "inv"; $("sort-select").value = "inv";
  resetWipe();
  $("settings-panel").hidden = true;
  renderAll();
  setStatus("Alles gelöscht.");
}

/* ---------- Ereignisse ---------- */

function wireEvents() {
  $("add-open").addEventListener("click", () => openForm("add"));
  $("settings-open").addEventListener("click", () => ($("settings-panel").hidden ? openSettings() : ($("settings-panel").hidden = true)));
  $("settings-close").addEventListener("click", () => { $("settings-panel").hidden = true; });
  $("examples-remove").addEventListener("click", removeExamples);

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
}

init();
