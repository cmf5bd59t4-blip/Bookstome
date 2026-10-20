// Verbindung zu Supabase: Konto, Bibliothek in der Datenbank, Einladungen und Freunde.
//
// Die App spricht die REST-Schnittstellen von Supabase direkt an (Auth unter /auth/v1,
// Datenbank unter /rest/v1). So braucht sie keine zusätzliche Bibliothek und keinen Build-Schritt.
// Welche Daten wer sehen darf, regelt die Datenbank selbst (siehe supabase-schema.sql).

import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

const SESSION_KEY = "bookstome-session";
const base = () => String(SUPABASE_URL || "").trim().replace(/\/+$/, "").replace(/\/(rest|auth)\/v1$/, "");
const key = () => String(SUPABASE_KEY || "").trim();

let session = null;
let refreshing = null;
const listeners = new Set();

export class CloudError extends Error {
  constructor(code, message, status = 0) { super(message); this.code = code; this.status = status; }
}

const MESSAGES = {
  user_already_exists: "Für diese E-Mail-Adresse gibt es schon ein Konto. Bitte anmelden.",
  email_exists: "Für diese E-Mail-Adresse gibt es schon ein Konto. Bitte anmelden.",
  invalid_credentials: "E-Mail-Adresse oder Passwort stimmt nicht.",
  weak_password: "Das Passwort ist zu schwach. Bitte mindestens 8 Zeichen verwenden.",
  email_address_invalid: "Diese E-Mail-Adresse sieht nicht richtig aus.",
  validation_failed: "Bitte E-Mail-Adresse und Passwort prüfen.",
  over_request_rate_limit: "Zu viele Versuche. Bitte in ein paar Minuten noch einmal.",
  over_email_send_rate_limit: "Zu viele Versuche. Bitte in ein paar Minuten noch einmal.",
  signup_disabled: "Neue Konten sind gerade nicht möglich.",
  email_not_confirmed: "Das Konto ist angelegt, aber die E-Mail-Adresse muss erst bestätigt werden. (Betreiber: in Supabase „Confirm email“ ausschalten.)",
  invite_invalid: "Diese Einladung gibt es nicht. Bitte um einen neuen Link.",
  invite_used: "Dieser Einladungslink wurde schon von jemand anderem genutzt. Bitte um einen neuen Link.",
  invite_expired: "Diese Einladung ist abgelaufen. Bitte um einen neuen Link.",
  invite_own: "Das ist dein eigener Einladungslink. Schick ihn an jemanden, den du einladen möchtest.",
  too_many_invites: "Heute wurden schon sehr viele Einladungen erstellt. Bitte morgen weitermachen.",
  network: "Keine Verbindung zum Server. Bist du online?",
  session: "Bitte melde dich erneut an.",
  forbidden: "Dafür fehlt die Berechtigung.",
};

/* ---------- Konfiguration ---------- */

function keyRole(k) {
  if (k.startsWith("sb_secret_")) return "secret";
  if (k.startsWith("sb_publishable_")) return "publishable";
  const parts = k.split(".");
  if (parts.length === 3) {
    try { return JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"))).role || "jwt"; } catch (e) { return "jwt"; }
  }
  return "unknown";
}

/** "ok", "off" (nicht eingerichtet) oder "unsafe" (geheimer Schlüssel eingetragen). */
export function configState() {
  if (!base() || !key()) return "off";
  const role = keyRole(key());
  if (role === "secret" || role === "service_role") return "unsafe";
  return "ok";
}
export const enabled = () => configState() === "ok";

/* ---------- Sitzung ---------- */

function readStored() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    return s && s.access_token && s.refresh_token && s.user && s.user.id ? s : null;
  } catch (e) { return null; }
}
function saveSession(s, silent = false) {
  const had = !!session && !silent;
  session = s;
  try { if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s)); else localStorage.removeItem(SESSION_KEY); } catch (e) { /* privat */ }
  if (had && !s) listeners.forEach((fn) => { try { fn(null); } catch (e) { /* ignore */ } });
}
function fromAuth(d) {
  if (!d || !d.access_token || !d.user) return null;
  const expiresAt = d.expires_at ? d.expires_at * 1000 : Date.now() + (Number(d.expires_in) || 3600) * 1000;
  return { access_token: d.access_token, refresh_token: d.refresh_token, expires_at: expiresAt, user: { id: d.user.id, email: d.user.email || "" } };
}

/** Wird aufgerufen, wenn die Sitzung abläuft und nicht erneuert werden kann. */
export function onSignedOut(fn) { listeners.add(fn); }
export function currentUser() { if (!session) session = readStored(); return session ? session.user : null; }
const uid = () => { const u = currentUser(); if (!u) throw new CloudError("session", MESSAGES.session, 401); return u.id; };

/* ---------- HTTP ---------- */

function headers(withBody, prefer, token) {
  const h = { apikey: key() };
  if (token) h.Authorization = "Bearer " + token;
  else if (keyRole(key()) === "anon") h.Authorization = "Bearer " + key(); // älterer anon-Key (JWT)
  if (withBody) h["Content-Type"] = "application/json";
  if (prefer) h.Prefer = prefer;
  return h;
}

function toError(status, d) {
  const o = d && typeof d === "object" ? d : {};
  const raw = String(o.message || o.msg || o.error_description || o.error || (typeof d === "string" ? d : "") || "");
  let code = MESSAGES[raw] ? raw : o.error_code || (typeof o.code === "string" && MESSAGES[o.code] ? o.code : "");
  if (!code && o.error === "invalid_grant") code = "invalid_credentials";
  if (!code && status === 429) code = "over_request_rate_limit";
  if (!code && status === 401) code = "session";
  if (!code && status === 403) code = "forbidden";
  if (!code && /password/i.test(raw) && /(least|short|weak)/i.test(raw)) code = "weak_password";
  const msg = MESSAGES[code] || "Das hat nicht geklappt" + (raw ? ": " + raw : " (Fehler " + status + ").");
  return new CloudError(code || "http_" + status, msg, status);
}

async function send(path, { method = "GET", body, prefer, token } = {}) {
  let res;
  try {
    res = await fetch(base() + path, {
      method,
      headers: headers(body !== undefined, prefer, token),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new CloudError("network", MESSAGES.network);
  }
  const text = await res.text().catch(() => "");
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch (e) { data = text; } }
  if (!res.ok) throw toError(res.status, data);
  return data;
}

async function refresh(force = false) {
  const stored = readStored();
  if (stored && (!session || stored.expires_at > session.expires_at)) session = stored; // anderer Tab war schneller
  if (!session) throw new CloudError("session", MESSAGES.session, 401);
  if (!force && Date.now() < session.expires_at - 60000) return;
  if (!refreshing) {
    const rt = session.refresh_token;
    refreshing = (async () => {
      try {
        const d = await send("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: rt } });
        const s = fromAuth(d);
        if (!s) throw new CloudError("session", MESSAGES.session, 401);
        saveSession(s);
      } catch (e) {
        if (e.code === "network") throw e;
        const again = readStored();
        if (again && again.refresh_token !== rt) { session = again; return; }
        saveSession(null);
        throw new CloudError("session", MESSAGES.session, 401);
      }
    })().finally(() => { refreshing = null; });
  }
  return refreshing;
}

/** Anfrage im Namen der angemeldeten Person; erneuert die Sitzung bei Bedarf. */
async function authed(path, opts = {}) {
  if (!currentUser()) throw new CloudError("session", MESSAGES.session, 401);
  await refresh(false);
  try {
    return await send(path, { ...opts, token: session.access_token });
  } catch (e) {
    if (e.status !== 401) throw e;
    await refresh(true);
    return send(path, { ...opts, token: session.access_token });
  }
}

/* ---------- Konto ---------- */

export async function signUp(email, password, name) {
  const d = await send("/auth/v1/signup", { method: "POST", body: { email, password, data: { display_name: name } } });
  const s = fromAuth(d);
  if (!s) throw new CloudError("email_not_confirmed", MESSAGES.email_not_confirmed);
  saveSession(s);
  await ensureProfile(name);
  return s.user;
}

export async function signIn(email, password) {
  const s = fromAuth(await send("/auth/v1/token?grant_type=password", { method: "POST", body: { email, password } }));
  if (!s) throw new CloudError("invalid_credentials", MESSAGES.invalid_credentials);
  saveSession(s);
  await ensureProfile("");
  return s.user;
}

export async function signOut() {
  const s = session || readStored();
  saveSession(null, true);
  if (s) { try { await send("/auth/v1/logout?scope=local", { method: "POST", token: s.access_token }); } catch (e) { /* egal */ } }
}

export async function deleteAccount() {
  await authed("/rest/v1/rpc/delete_my_account", { method: "POST", body: {} });
  saveSession(null, true);
}

/* ---------- Profil ---------- */

export async function getProfile() {
  const rows = await authed("/rest/v1/profiles?select=display_name,library_name,recommendation&id=eq." + uid());
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function ensureProfile(name) {
  const fallback = (currentUser().email || "").split("@")[0].slice(0, 60);
  const p = await getProfile();
  if (!p) {
    await authed("/rest/v1/profiles?on_conflict=id", {
      method: "POST",
      body: { id: uid(), display_name: (name || fallback).slice(0, 60) },
      prefer: "resolution=ignore-duplicates,return=minimal",
    });
  } else if (!p.display_name) {
    await updateProfile({ display_name: (name || fallback).slice(0, 60) });
  }
}

export function updateProfile(patch) {
  return authed("/rest/v1/profiles?id=eq." + uid(), { method: "PATCH", body: patch, prefer: "return=minimal" });
}

/* ---------- Bücher ---------- */

function toRow(owner, b) {
  const { id, hidden, ...data } = b;
  return { owner, id, hidden: !!hidden, data };
}
function fromRow(r) { return { ...r.data, id: r.id, hidden: !!r.hidden }; }

/** Bücher einer Person (eigene oder die eines Freundes). Verborgene Bücher von Freunden liefert die Datenbank nicht aus. */
export async function listBooks(owner = uid()) {
  const rows = await authed("/rest/v1/books?select=id,data,hidden&owner=eq." + encodeURIComponent(owner) + "&order=id");
  return (rows || []).map(fromRow);
}

export async function saveBooks(books) {
  const owner = uid();
  let chunk = [], size = 0;
  const flush = async () => {
    if (!chunk.length) return;
    await authed("/rest/v1/books?on_conflict=owner,id", { method: "POST", body: chunk, prefer: "resolution=merge-duplicates,return=minimal" });
    chunk = []; size = 0;
  };
  for (const b of books) {
    const row = toRow(owner, b);
    const n = JSON.stringify(row).length;
    if (chunk.length && size + n > 700000) await flush();
    chunk.push(row); size += n;
  }
  await flush();
}

export async function deleteBooks(ids) {
  if (!ids.length) return;
  const list = ids.map((i) => '"' + String(i).replace(/["\\]/g, "") + '"').join(",");
  await authed("/rest/v1/books?owner=eq." + uid() + "&id=in.(" + encodeURIComponent(list) + ")", { method: "DELETE", prefer: "return=minimal" });
}

export async function deleteAllBooks() {
  await authed("/rest/v1/books?owner=eq." + uid(), { method: "DELETE", prefer: "return=minimal" });
}

/* ---------- Einladungen und Freunde ---------- */

const rpc = (fn, args = {}) => authed("/rest/v1/rpc/" + fn, { method: "POST", body: args });

export const createInvite = () => rpc("create_invite");
export const acceptInvite = (token) => rpc("accept_invite", { p_token: token });
export const listFriends = async () => (await rpc("my_friends")) || [];
export const removeFriend = (id) => rpc("remove_friend", { p_friend: id });

/** Name der einladenden Person. Funktioniert auch ohne Anmeldung. */
export async function inviteInfo(token) {
  const path = "/rest/v1/rpc/invite_info";
  if (currentUser()) return authed(path, { method: "POST", body: { p_token: token } });
  return send(path, { method: "POST", body: { p_token: token } });
}

export const isValidInviteToken = (t) => typeof t === "string" && /^[a-f0-9]{32}$/.test(t);
