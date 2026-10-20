# Bookstome

Ein persönliches Leseinventar für den Browser: Bücher mit Mini-Cover, Kategorie, Kurzrezension und eigener Sternebewertung erfassen, auf Basis der Bewertungen von Claude das nächste Buch empfehlen lassen und die Bibliotheken von Freunden ansehen.

Die App läuft in zwei Betriebsarten:

- **Mit Konto (Supabase)**: Jede Person meldet sich mit E-Mail und Passwort an. Die Bibliothek liegt in einer Datenbank und ist auf jedem Gerät da. Über einen Einladungslink, zum Beispiel per WhatsApp, werden zwei Personen zu Freunden und sehen gegenseitig ihre Bibliotheken. Siehe „Konten und Freunde einrichten“.
- **Ohne Konto**: Bleiben `SUPABASE_URL` und `SUPABASE_KEY` in `config.js` leer, liegt jede Bibliothek nur im Browser der jeweiligen Person, wie in Version 1.

Die App funktioniert auf Handy und Computer und lässt sich auf den Startbildschirm legen.

## Funktionen

- **Inventar**: Autor, Titel, Untertitel, Erscheinungsjahr (Erstausgabe im Original), Originalsprache, eigene Ausgabe, Auszeichnung, Kurzrezension, Inventarnummer.
- **Mini-Cover**: Foto vom Buch aufnehmen oder auswählen und im Rahmen zurechtziehen. Ohne Foto gibt es ein schlichtes Schrift-Cover.
- **Kategorien**: Belletristik, Autobiografisches, Sachbuch, Biografie, Krimi & Thriller, Lyrik & Drama, Ratgeber, Sonstiges. Die Liste lässt sich nach Kategorie filtern.
- **Bewertung**: 1 bis 5 Sterne pro Buch, Sortierung nach Autor, Titel, Jahr oder Bewertung.
- **Empfehlung**: Claude schlägt auf Basis der Sterne drei Bücher vor (naheliegend, neues Terrain, Sachbuch oder Wiederentdeckung) und wiederholt keine früheren Vorschläge.
- **Mit Claude ergänzen**: Füllt beim Anlegen leere Felder wie Jahr, Kategorie und Kurzrezension.
- **Sichern und umziehen**: Export als JSON-Datei, Import mit „Zusammenführen“ oder „Ersetzen“.
- **Beispiele**: Ohne Konto kann eine leere App fünf Beispielbücher laden, um sie auszuprobieren.
- **Freunde** (mit Konto): Einladen per WhatsApp, Link oder Teilen-Menü. Jeder Link gilt für eine Person und 30 Tage. Freunde sehen Bücher, Sterne und Kurzrezensionen, aber nicht die Bücher, die beim Bearbeiten „Für Freunde verborgen“ wurden. Mit „Auch gelesen“ übernimmt man ein Buch aus der Bibliothek eines Freundes in die eigene und bewertet es selbst.
- **Übernahme** (mit Konto): Liegen auf dem Gerät noch Bücher aus der Zeit ohne Konto, bietet die App nach der Anmeldung an, sie samt Sternen ins Konto zu übernehmen.

## Nutzen

Die App ist eine statische Website. Wer den Link öffnet, legt ein Konto an (mit Supabase) oder bekommt eine eigene, leere Bibliothek im Browser (ohne Supabase).

- **Auf den Startbildschirm legen**: Auf dem iPhone in Safari „Teilen“ → „Zum Home-Bildschirm“, auf Android im Browsermenü „App installieren“ oder „Zum Startbildschirm hinzufügen“.
- **Sichern**: Unter „Einstellungen und Daten“ → „Bibliothek exportieren“. Browser können gespeicherte Daten unter Umständen löschen (z. B. beim Aufräumen von Website-Daten), deshalb regelmäßig exportieren.
- **Gerät wechseln**: Mit Konto einfach auf dem neuen Gerät anmelden. Ohne Konto auf dem alten Gerät exportieren und auf dem neuen importieren.

## Konten und Freunde einrichten

Einmalig, etwa 15 Minuten. Der kostenlose Supabase-Plan reicht für einen Freundeskreis.

1. Auf [supabase.com](https://supabase.com) ein Konto anlegen (Anmeldung mit GitHub geht) und ein neues Projekt erstellen. Region am besten „Central EU (Frankfurt)“.
2. **SQL Editor** → „New query“ → den Inhalt von `supabase-schema.sql` einfügen → „Run“. Das legt Tabellen, Zugriffsregeln und Funktionen an. Das Skript darf mehrfach laufen.
3. **Authentication → Sign In / Providers → Email**: „Confirm email“ ausschalten. Der kostenlose Supabase-Mailversand schickt nur an Mitglieder des Projektteams und höchstens zwei Mails pro Stunde; ohne Bestätigungsmail können sich Freunde direkt mit E-Mail und Passwort anmelden.
4. **Project Settings → API Keys**: den „Publishable key“ (`sb_publishable_…`, in älteren Projekten „anon public“) kopieren, unter **Data API** die „Project URL“. Beides in `config.js` bei `SUPABASE_KEY` und `SUPABASE_URL` eintragen und hochladen.

**Niemals den „Secret key“ bzw. „service_role“ Key in die App schreiben.** Er umgeht alle Zugriffsregeln. Die App erkennt ihn und arbeitet dann ohne Konto.

Sicherheit: Publishable key und URL sind öffentlich. Wer was sehen darf, regelt die Datenbank selbst mit Row Level Security: eigene Daten lesen und schreiben, Bücher von Freunden nur lesen (ohne verborgene), Einladungen und Freundschaften nur über die Funktionen in `supabase-schema.sql`. E-Mail-Adressen sieht niemand außer der Person selbst.

Passwort vergessen: Mailversand ist ohne eigenen Mailserver aus (siehe Schritt 3), deshalb setzt der Betreiber das Passwort in Supabase unter **Authentication → Users** zurück. Wer später eine eigene Domain hat, kann unter **Authentication → Emails → SMTP Settings** einen Mailserver eintragen.

Kostenlose Supabase-Projekte werden nach einer Woche ohne Nutzung pausiert. Wer das vermeiden will, legt im Repository die Datei `.github/workflows/keepalive.yml` an (Inhalt siehe `keepalive.yml` in diesem Ordner); GitHub ruft die Datenbank dann zweimal pro Woche kurz auf.

## Claude-Funktionen

Empfehlung und Ergänzen funktionieren auf zwei Wegen:

1. **Ohne API-Schlüssel**: Die App zeigt einen fertigen Prompt. Man kopiert ihn in die Claude-App oder auf claude.ai, kopiert die Antwort zurück und tippt auf „Übernehmen“. Dafür reicht ein normales Claude-Konto.
2. **Mit eigenem API-Schlüssel**: Unter „Einstellungen und Daten“ einen Schlüssel aus der Claude Console (https://platform.claude.com) hinterlegen. Dann geht es per Knopfdruck. Die Anfragen werden über das API-Konto der jeweiligen Person abgerechnet.

Der Schlüssel wird nur im Browser der Person gespeichert und nur an `api.anthropic.com` gesendet. Die App ruft die API direkt aus dem Browser auf (Header `anthropic-dangerous-direct-browser-access`). Das ist hier vertretbar, weil jede Person ihren eigenen Schlüssel verwendet. **Niemals einen Schlüssel in den Code oder in das Repository schreiben.** Wer ein gemeinsam genutztes Gerät verwendet, sollte den Schlüssel nach Gebrauch wieder entfernen.

Das Modell ist in den Einstellungen wählbar (Standard: Claude Sonnet 5.5). Die Liste steht in `config.js`.

## Veröffentlichen mit GitHub Pages

1. Auf GitHub ein neues, öffentliches Repository anlegen, z. B. `meine-bibliothek`.
2. Alle Dateien dieses Ordners hochladen: auf der leeren Repository-Seite „uploading an existing file“ (oder „Add file“ → „Upload files“), alle Dateien auf einmal auswählen oder hineinziehen, dann „Commit changes“. Alle Dateien liegen bewusst in einem Ordner ohne Unterordner, damit das in einem Schritt geht. Mit `git push` geht es natürlich auch.
3. Im Repository unter **Settings → Pages** als Quelle „Deploy from a branch“, Branch `main`, Ordner `/ (root)` wählen und speichern.
4. Nach ein bis zwei Minuten ist die App unter `https://<benutzername>.github.io/meine-bibliothek/` erreichbar. Diesen Link teilen.

Jeder andere statische Hoster (Netlify, Cloudflare Pages, eigener Webspace) funktioniert genauso. Die App braucht HTTPS, damit Offline-Modus und Installation funktionieren.

## Lokal entwickeln

Es gibt keinen Build-Schritt und keine Abhängigkeiten. Nur einen kleinen Webserver starten, weil ES-Module nicht über `file://` laden:

```bash
cd meine-bibliothek
python3 -m http.server 8000
# dann http://localhost:8000 öffnen
```

Der Service Worker liefert online immer die aktuelle Version aus („Netz zuerst“). Wer trotzdem eine alte Fassung sieht: in den Entwicklertools unter „Application → Service Workers“ auf „Update on reload“ stellen.

## Aufbau

```
index.html                Seitengerüst und alle Bereiche (Einstellungen, Empfehlung, Formular, Liste)
manifest.webmanifest      Angaben für „Zum Startbildschirm hinzufügen“
sw.js                     Service Worker für Offline-Nutzung
config.js                 Kategorien, Modelle, Versionsnummer, Cover-Maße, Supabase-Verbindung
store.js                  Speicherung in IndexedDB, Datenprüfung, Export/Import, Zusammenführen
cloud.js                  Supabase: Anmeldung, Bücher in der Datenbank, Einladungen, Freunde
supabase-schema.sql       Datenbank für Supabase: Tabellen, Zugriffsregeln, Funktionen
keepalive.yml             Vorlage für GitHub Actions, damit das kostenlose Supabase-Projekt nicht pausiert
claude.js                 Prompts, Aufruf der Claude API, Auswertung der Antworten
cover.js                  Cover-Zuschnitt (Verschieben, Zoomen, JPEG-Ausgabe)
app.js                    Oberfläche und Abläufe
styles.css                Gestaltung, helles und dunkles Farbschema
beispiel-bibliothek.json  Beispielbibliothek für den ersten Start
icon*.png, icon.svg       App-Icons
```

## Datenformat

Export-Dateien sehen so aus (gekürzt):

```json
{
  "format": "meine-bibliothek",
  "version": 1,
  "exportedAt": "2026-10-14T14:45:00.000Z",
  "libraryName": "Meine Bibliothek",
  "books": [
    {
      "id": "kafka-derprocess-ab12",
      "inv": 1,
      "author": "Franz Kafka",
      "sortAuthor": "Kafka",
      "title": "Der Process",
      "subtitle": "",
      "year": 1925,
      "category": "Belletristik",
      "lang": "deutsch",
      "edition": "Fischer",
      "award": "",
      "review": "…",
      "rating": 5,
      "cover": "data:image/jpeg;base64,…",
      "createdAt": "…",
      "updatedAt": "…"
    }
  ],
  "recommendation": { "items": [], "history": [], "createdAt": "…", "basisKey": "…", "ratedCount": 0 }
}
```

`rating` ist 0 für „nicht bewertet“, sonst 1 bis 5. `cover` ist ein JPEG mit 200 × 300 Pixeln als Data-URL oder `null`. Wer das Format inkompatibel ändert, erhöht `FORMAT_VERSION` in `config.js` und ergänzt in `parseImport()` eine Umwandlung für alte Dateien.

## Mitentwickeln

- Bitte ohne Frameworks und ohne Build-Schritt bleiben: einfaches HTML, CSS und JavaScript-Module. So kann jede Person die App ohne Installation verändern und hosten.
- Texte in der Oberfläche sind auf Deutsch, kurz und aktiv formuliert.
- Neue Dateien in `sw.js` in die Liste `FILES` eintragen und `CACHE` hochzählen.
- Farben nur über die Variablen in `styles.css` setzen, damit helles und dunkles Schema funktionieren.
- Vor einem Pull Request einmal durchklicken: Buch anlegen, bewerten, bearbeiten, entfernen, exportieren, importieren, auf Handybreite ansehen.

Ideen für die nächsten Schritte: Leseliste für noch ungelesene Bücher, Lesedatum und Notizen, Statistik nach Jahren und Kategorien, ISBN-Suche, Empfehlungen aus dem Freundeskreis, Ausleihen unter Freunden.

## Lizenz

MIT, siehe `LICENSE`.
