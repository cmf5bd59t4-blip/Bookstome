// Zentrale Einstellungen der App. Wer Kategorien, Modelle oder Texte ändern will, fängt hier an.

export const APP_VERSION = "2.0.0";
export const APP_NAME = "Bookstome";

/**
 * Verbindung zu Supabase für Konten, gemeinsame Datenbank und Freunde.
 * Beide Werte stehen in Supabase unter Project Settings → API Keys bzw. Data API.
 * SUPABASE_KEY ist der "Publishable key" (sb_publishable_…) oder der ältere "anon public" Key.
 * Diese Werte sind öffentlich; die Daten schützt die Datenbank selbst (Row Level Security).
 * NIEMALS den "Secret key" bzw. "service_role" Key eintragen.
 * Beide leer lassen: Dann bleibt jede Bibliothek wie bisher nur im eigenen Browser, ohne Konto und Freunde.
 */
export const SUPABASE_URL = "https://ziiamxyvtpxhhxrwallw.supabase.co";
export const SUPABASE_KEY = "sb_publishable_njsXuvhAXTm6jKqOJg2GqQ_IWKt5pme";

/** Format-Kennung für Export-Dateien. Bei inkompatiblen Änderungen FORMAT_VERSION erhöhen. */
export const FORMAT = "meine-bibliothek";
export const FORMAT_VERSION = 1;

export const CATEGORIES = [
  "Belletristik",
  "Autobiografisches",
  "Sachbuch",
  "Biografie",
  "Krimi & Thriller",
  "Lyrik & Drama",
  "Ratgeber",
  "Sonstiges",
];

export const RATING_LABELS = ["Noch nicht bewertet", "Ging so", "Ordentlich", "Gut", "Sehr gut", "Herausragend"];

/** Claude-Modelle für Empfehlung und Ergänzen. IDs siehe https://platform.claude.com/docs/en/models/overview */
export const MODELS = [
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 – ausgewogen (Standard)" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 – schnell und günstig" },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 – am gründlichsten" },
];
export const DEFAULT_MODEL = MODELS[0].id;

/** Mindestanzahl bewerteter Bücher, bevor eine Empfehlung sinnvoll ist. */
export const MIN_RATED_FOR_RECOMMENDATION = 3;

/** Maße der gespeicherten Cover (Pixel). */
export const COVER_WIDTH = 200;
export const COVER_HEIGHT = 300;
