// Anbindung an Claude: Prompts bauen, Claude API aufrufen, Antworten prüfen.
//
// Zwei Wege:
// 1. Mit eigenem API-Schlüssel: Die App ruft https://api.anthropic.com/v1/messages direkt aus dem Browser auf.
//    Der Schlüssel bleibt im Browser der jeweiligen Person und wird nur an Anthropic gesendet.
// 2. Ohne Schlüssel: Die App zeigt den Prompt zum Kopieren. Man fügt ihn in der Claude-App ein und
//    kopiert die Antwort zurück. parseAnswer() liest beide Wege gleich.

import { CATEGORIES } from "./config.js";

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

export class ClaudeError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/** Ruft die Claude API auf und gibt den Antworttext zurück. */
export async function callClaude({ apiKey, model, prompt, maxTokens = 1500, signal }) {
  let res;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": API_VERSION,
        // Erlaubt den Aufruf direkt aus dem Browser. Nur sinnvoll, weil jede Person ihren eigenen Schlüssel nutzt.
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }),
    });
  } catch (e) {
    if (e && e.name === "AbortError") throw new ClaudeError("cancelled", "Abgebrochen.");
    throw new ClaudeError("network", "Claude ist nicht erreichbar. Bitte die Internetverbindung prüfen.");
  }
  if (!res.ok) {
    let detail = "";
    try { const body = await res.json(); detail = body && body.error && body.error.message ? body.error.message : ""; } catch (e) { /* ignore */ }
    if (res.status === 401) throw new ClaudeError("auth", "Der API-Schlüssel wurde abgelehnt. Bitte in den Einstellungen prüfen.");
    if (res.status === 403) throw new ClaudeError("forbidden", "Dieser API-Schlüssel darf das gewählte Modell nicht nutzen.");
    if (res.status === 404) throw new ClaudeError("model", "Das gewählte Modell ist nicht verfügbar. Bitte in den Einstellungen ein anderes wählen.");
    if (res.status === 429) throw new ClaudeError("rate", "Gerade zu viele Anfragen oder das Guthaben ist aufgebraucht. Bitte später erneut versuchen.");
    if (res.status === 529 || res.status >= 500) throw new ClaudeError("overloaded", "Claude ist gerade überlastet. Bitte gleich noch einmal versuchen.");
    throw new ClaudeError("request", "Die Anfrage wurde abgelehnt" + (detail ? ": " + detail : "."));
  }
  const data = await res.json();
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  if (!text) throw new ClaudeError("empty", "Claude hat keine Antwort geliefert.");
  return text;
}

/** Liest JSON aus einer Antwort, auch wenn sie in einen Codeblock oder einen Satz eingebettet ist. */
export function parseAnswer(text) {
  const t = String(text || "").trim();
  const tries = [t];
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) tries.push(fence[1]);
  const first = t.indexOf("{"), last = t.lastIndexOf("}");
  if (first >= 0 && last > first) tries.push(t.slice(first, last + 1));
  for (const candidate of tries) {
    try { return JSON.parse(candidate); } catch (e) { /* next */ }
  }
  throw new ClaudeError("json", "Die Antwort enthält kein lesbares JSON. Bitte die komplette Antwort von Claude einfügen.");
}

const s = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/* ---------- Empfehlung ---------- */

export function recommendationPrompt(books, history = []) {
  const lines = [...books]
    .sort((a, b) => (b.rating || 0) - (a.rating || 0))
    .map((b) => `- ${b.author}: „${b.title}“ (${b.year || "Jahr unbekannt"}, ${b.category}) – ${b.rating ? b.rating + " von 5 Sternen" : "unbewertet"}`)
    .join("\n");
  const hist = history.filter(Boolean).slice(-30);
  return [
    "Du bist eine sehr belesene Buchhändlerin. Eine Person hat diese Bücher gelesen und mit 1 bis 5 Sternen bewertet. Sie hat vor allem Bücher aufgenommen, die ihr gefallen haben; 3 Sterne heißt also „eher mittel im Vergleich“, 5 Sterne „herausragend“.",
    "",
    lines,
    "",
    "Empfiehl genau drei Bücher für ihr nächstes Leseerlebnis. Regeln:",
    "- Keines der Bücher aus der Liste" + (hist.length ? " und keines dieser bereits empfohlenen: " + hist.join("; ") : "") + ".",
    "- Nur Bücher, die es wirklich gibt und die auf Deutsch erhältlich sind. Nenne den deutschen Titel und das Jahr der Erstausgabe im Original.",
    "- Richte dich nach den hoch bewerteten Büchern, ihren Themen, Regionen und Erzählweisen. Meide, was vor allem den mittel bewerteten ähnelt.",
    "- Buch 1 mit label „Naheliegend“: trifft den Kern des Geschmacks. Buch 2 mit label „Neues Terrain“: andere Region, Epoche oder Form, die trotzdem passt. Buch 3: ein Sachbuch oder autobiografisches Buch mit label „Sachbuch“ oder „Autobiografisch“, falls die Bewertungen Interesse daran zeigen, sonst ein weiterer Roman mit label „Wiederentdeckung“.",
    "- reason: zwei Sätze auf Deutsch, worum es geht und warum es passt. Keine Zitate, keine Spoiler zum Ende.",
    "- basedOn: ein bis drei Titel aus der Liste, genau so geschrieben wie dort.",
    "- category: genau eine aus: " + CATEGORIES.join(", ") + ".",
    "",
    "Antworte nur mit JSON in dieser Form:",
    '{"items":[{"label":"Naheliegend","author":"…","title":"…","year":1999,"category":"Belletristik","reason":"…","basedOn":["…"]}]}',
  ].join("\n");
}

/** Prüft eine Empfehlungs-Antwort und entfernt Bücher, die schon in der Bibliothek stehen. */
export function normalizeRecommendation(data, ownedTitleKeys) {
  const items = (data && Array.isArray(data.items) ? data.items : [])
    .filter((it) => it && s(it.title, 300) && s(it.author, 200))
    .filter((it) => !ownedTitleKeys.has(normTitle(it.title)))
    .slice(0, 3)
    .map((it) => {
      const y = Number(it.year);
      return {
        label: s(it.label, 40),
        author: s(it.author, 200),
        title: s(it.title, 300),
        year: Number.isFinite(y) && y > 0 ? Math.round(y) : null,
        category: CATEGORIES.includes(it.category) ? it.category : "Belletristik",
        reason: s(it.reason, 800),
        basedOn: Array.isArray(it.basedOn) ? it.basedOn.map((x) => s(x, 300)).filter(Boolean).slice(0, 3) : [],
      };
    });
  if (!items.length) throw new ClaudeError("empty", "Die Antwort enthielt keine neuen Bücher. Bitte noch einmal versuchen.");
  return items;
}

export function normTitle(t) {
  return String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "");
}

/* ---------- Felder ergänzen ---------- */

export function fillPrompt(author, title) {
  return [
    "Zu diesem Buch brauche ich Katalogangaben auf Deutsch.",
    "Autor: " + author,
    "Titel: " + title,
    "",
    "Antworte nur mit JSON:",
    '{"known":true,"year":2001,"category":"Belletristik","lang":"aus dem Englischen","subtitle":"","review":"…"}',
    "Regeln:",
    "- year: Jahr der Erstausgabe im Original, als Zahl.",
    "- category: genau eine aus: " + CATEGORIES.join(", ") + ".",
    '- lang: "deutsch", wenn das Original deutsch ist, sonst "aus dem …" (z. B. "aus dem Spanischen").',
    "- subtitle: Untertitel der deutschen Ausgabe, sonst leer.",
    "- review: Kurzrezension in zwei bis drei Sätzen, etwa 50 Wörter, sachlich, ohne Zitate, ohne das Ende zu verraten.",
    '- Wenn du das Buch nicht sicher kennst, antworte {"known":false} und erfinde nichts.',
  ].join("\n");
}

export function normalizeFill(data) {
  if (!data || data.known === false) throw new ClaudeError("unknown", "Claude kennt dieses Buch nicht sicher. Bitte die Felder selbst ausfüllen.");
  const y = Number(data.year);
  return {
    year: Number.isFinite(y) && y >= 1 && y <= 2100 ? Math.round(y) : null,
    category: CATEGORIES.includes(data.category) ? data.category : "",
    lang: s(data.lang, 80),
    subtitle: s(data.subtitle, 300),
    review: s(data.review, 1500),
  };
}
