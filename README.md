# Meine Bibliothek

Ein persönliches Leseinventar für den Browser: Bücher mit Mini-Cover, Kategorie, Kurzrezension und eigener Sternebewertung erfassen und auf Basis der Bewertungen von Claude das nächste Buch empfehlen lassen.

Jede Person hat ihre eigene Bibliothek. Die Daten liegen nur im Browser der jeweiligen Person, es gibt keinen Server und kein Konto. Die App funktioniert auf Handy und Computer, lässt sich auf den Startbildschirm legen und läuft danach auch offline.

## Funktionen

- **Inventar**: Autor, Titel, Untertitel, Erscheinungsjahr (Erstausgabe im Original), Originalsprache, eigene Ausgabe, Auszeichnung, Kurzrezension, Inventarnummer.
- **Mini-Cover**: Foto vom Buch aufnehmen oder auswählen und im Rahmen zurechtziehen. Ohne Foto gibt es ein schlichtes Schrift-Cover.
- **Kategorien**: Belletristik, Autobiografisches, Sachbuch, Biografie, Krimi & Thriller, Lyrik & Drama, Ratgeber, Sonstiges. Die Liste lässt sich nach Kategorie filtern.
- **Bewertung**: 1 bis 5 Sterne pro Buch, Sortierung nach Autor, Titel, Jahr oder Bewertung.
- **Empfehlung**: Claude schlägt auf Basis der Sterne drei Bücher vor (naheliegend, neues Terrain, Sachbuch oder Wiederentdeckung) und wiederholt keine früheren Vorschläge.
- **Mit Claude ergänzen**: Füllt beim Anlegen leere Felder wie Jahr, Kategorie und Kurzrezension.
- **Sichern und umziehen**: Export als JSON-Datei, Import mit „Zusammenführen“ oder „Ersetzen“.
- **Beispiele**: Eine leere App kann fünf Beispielbücher laden, um sie auszuprobieren.

## Nutzen

Die App ist eine statische Website. Wer den Link öffnet, bekommt eine eigene, leere Bibliothek.

- **Auf den Startbildschirm legen**: Auf dem iPhone in Safari „Teilen“ → „Zum Home-Bildschirm“, auf Android im Browsermenü „App installieren“ oder „Zum Startbildschirm hinzufügen“.
- **Sichern**: Unter „Einstellungen und Daten“ → „Bibliothek exportieren“. Browser können gespeicherte Daten unter Umständen löschen (z. B. beim Aufräumen von Website-Daten), deshalb regelmäßig exportieren.
- **Gerät wechseln**: Auf dem alten Gerät exportieren, auf dem neuen Gerät importieren.

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
config.js                 Kategorien, Modelle, Versionsnummer, Cover-Maße
store.js                  Speicherung in IndexedDB, Datenprüfung, Export/Import, Zusammenführen
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

Ideen für die nächsten Schritte: Leseliste für noch ungelesene Bücher, Lesedatum und Notizen, Statistik nach Jahren und Kategorien, ISBN-Suche, Synchronisation zwischen Geräten.

## Lizenz

MIT, siehe `LICENSE`.
