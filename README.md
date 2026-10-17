# AI Content Factory – Studio v1

Mobile-first Content-Studio für Social-Media-Konzepte, Bild-/Videouploads, Storyboards, Untertitel und Video-Export.

## Bereits funktionsfähig

- Drei **unterschiedliche** deutschsprachige Content-Konzepte pro Thema – ohne API-Schlüssel durch nachvollziehbare Textvorlagen.
- Optional **echte KI-Texte** via serverseitiger Cloudflare-Worker-Schnittstelle und OpenAI-API.
- **Kostenloses Vorlesen** auf Deutsch mit der integrierten Gerätestimme des Browsers (ohne API-Schlüssel; nur Wiedergabe, kein Export).
- **Kostenlose Piper-TTS-WAV-Generierung direkt im Browser** (Thorsten Medium/High mit 256 Phonemsymbolen) über eine lokal gebündelte Variante von `@mintplex-labs/piper-tts-web@1.0.5`; erstes Laden benötigt größere ONNX-/WASM-Dateien und kann je nach Mobilgerät scheitern. Die WAV-Datei wird als Sprecherstimme im Entwurf verwendet und kann heruntergeladen werden.
- Optional OpenAI-TTS im Cloudflare-Worker-Backend vorhanden, die normale Oberfläche verwendet standardmäßig **keine** kostenpflichtige Sprachgenerierung.
- Upload von Bildern und Videos (Dateien werden im Browser verarbeitet, nicht auf den Server hochgeladen).
- Editierbare Titel, Sprechertexte, Posts und Szenen-Captions.
- Herunterladen von Untertiteln (.srt), strukturiertem Konzept (.json), kopierbarer Caption.
- Browserseitiges vertikales Video (540×960) im WebM-Format. Eingerichtete eigene oder KI-Audiospur wird mitaufgezeichnet, wenn Browser-WebAudio unterstützt wird.
- Automatisches lokales Speichern von Textentwürfen. Medien bleiben nur im aktuellen Browser-Tab; nach Neuladen erneut auswählen.
- Mobiloptimiertes Layout; keine Framework-Abhängigkeiten im Frontend.

## Lokal sofort starten

Python 3 erforderlich. Im Projektordner:

```bash
python3 -m http.server 8080 -d public
```

Danach **http://localhost:8080** öffnen. Die App läuft im Vorlagenmodus ohne zusätzliche Installation. Das kostenlose Vorlesen funktioniert unabhängig von der kostenpflichtigen KI-API; die Piper-WAV-Funktion benötigt beim ersten Start eine Internetverbindung für Bibliothek, Laufzeit und deutsches Modell. Die KI-Endpunkte sind lokal ohne Worker nicht aktiv.

## Cloudflare Workers deployen

1. Neues Cloudflare-Worker-Projekt in einem Cloudflare-Konto erstellen und dieses Verzeichnis als Worker-Projekt verwenden.
2. Cloudflare Wrangler installieren bzw. mit `npx wrangler` ausführen; `wrangler.jsonc` ist vorbereitet.
3. `npx wrangler deploy` im Projektordner ausführen und den angezeigten Worker-Link öffnen.
4. **Vor** Nutzung der kostenpflichtigen KI-Funktionen serverseitige Secrets setzen:

```bash
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put STUDIO_ACCESS_KEY
```

`STUDIO_ACCESS_KEY` muss mindestens 16 Zeichen haben. In der Weboberfläche unter **Einstellungen** denselben Studio-Schlüssel eingeben, damit nur berechtigte Personen API-Kosten auslösen. Der Schlüssel wird **nur innerhalb der jeweiligen Tab-Sitzung** gespeichert. Niemals `OPENAI_API_KEY` direkt in Browsercode, GitHub oder eine öffentlich sichtbare Datei schreiben.

Optional per `wrangler.jsonc` oder Secrets `AI_MODEL`, `TTS_MODEL`, `TTS_VOICE` anpassen. Standard: `gpt-4.1-mini`, `gpt-4o-mini-tts`, `coral`. Diese API-Nutzung kann Kosten verursachen.


### Piper: alter Fehler mit Lautsymbol 140 behoben
- Die alten deutschen Piper-Low-Stimmen **Kerstin low** und **Thorsten low** verwenden nur 130 Lautsymbole. Die Phonemisierung kann aber Index **140** (z. B. beim deutschen „ch“) erzeugen; ONNX wirft dann den Fehler `/enc_p/emb/Gather`. Das ist für Piper in [rhasspy/piper#104](https://github.com/rhasspy/piper/issues/104) dokumentiert.
- Die Oberfläche verwendet deshalb nur noch **Thorsten medium** (Standard) und **Thorsten high** (größer), mit jeweils **256** Symbolen. Konfigurationsdateien mit weniger als 154 Symbolen werden **vor dem ONNX-Lauf** abgelehnt. Es werden keine Lautsymbole einfach abgeschnitten, da das die Sprache verfälschen würde.
- Erfolgreiche Bereitstellung und Modellkompatibilität garantieren allein noch keine erfolgreiche Audioerzeugung auf jedem Android-Gerät; unbedingt kurzen Sprachtest im Browser durchführen.

### Piper: browsergerechter ONNX-Build (Android-Fix)

- Der frühere direkte CDN-Import von Piper lieferte in mobilen Browsern die fehlerhafte ONNX-WebAssembly-Initialisierung `I.dirname is not a function`. Deshalb werden Piper `1.0.5` und ONNX Runtime Web `1.18.0` jetzt mit Vite als **Browser-Bundle** erzeugt.
- `npm install` führt per `postinstall` automatisch `npm run build` aus und schreibt `public/vendor/piper-tts.js` sowie benötigte Chunks. Der Worker lädt nun ausschließlich dieses lokal bereitgestellte Modul.
- Für GitHub→Cloudflare Workers Builds: Das integrierte `postinstall` setzt voraus, dass die Installationsphase npm-Skripte ausführt. Andernfalls im Cloudflare-Dashboard unter **Einstellungen → Builds → Build command** `npm run build` eintragen; Deploy command bleibt `npx wrangler deploy`. Wrangler-Konfigurations-`build` wird bei Workers Builds derzeit nicht automatisch berücksichtigt.
- Nach der Veröffentlichung muss `/vendor/piper-tts.js` JavaScript (HTTP 200) liefern. Eine reine GitHub-Änderung ohne erfolgreichen Build genügt nicht.
- Der ONNX-WASM-Dateipfad bleibt zur passenden v1.18.0 über den erlaubten Cloudflare-Proxy geroutet. Das Verhindern des Browser-/Node-Bundlingfehlers allein garantiert noch nicht die erfolgreiche Audiosynthese auf jedem Tablet.

### Piper: Hintergrundprozess, kurzer Test und Abbruch

- Die Sprachberechnung läuft jetzt in `public/piper-worker.js`, einem separaten Browser-Hintergrundprozess. So bleibt die Oberfläche bei langsamer oder hängender ONNX-/Phonemizer-Verarbeitung bedienbar.
- Zuerst **Kurzen Test sprechen** verwenden; dieser erzeugt eine kurze WAV-Datei, unabhängig von der Länge des Entwurfs.
- Für längere Entwürfe teilt die Anwendung den Text in kleine Abschnitte auf, zeigt die abgeschlossenen Abschnitte an und verbindet die PCM-Stücke zu einer WAV-Datei.
- **Abbrechen** beendet den Worker. Ein Zeitlimit beendet hängengebliebene Vorgänge automatisch (95 Sekunden je Sprachabschnitt, sechs Minuten insgesamt).
- Der Balken zeigt echte Download-Prozente oder abgeschlossene Sprachabschnitte. Während eines laufenden Sprachabschnitts werden die Sekunden angezeigt, keine erfundenen Prozentwerte.
- Im ersten Sprachabschnitt lädt Piper unter Umständen noch die Phonemizer-Laufzeit. Ein erfolgreich initialisiertes Sprachmodell beweist daher nicht, dass alle WASM-Dateien bereits im Browser geladen sind.
- Diese Änderungen sind syntaktisch geprüft, aber die erfolgreiche Audioerzeugung auf jedem Android-Browser kann erst durch einen Endgerätetest bestätigt werden.

### Piper: kostenloser WAV-Export und Netzwerkdiagnose

- Die Browser-App verwendet den lokal gebündelten, browsergerechten Piper-Code aus `/vendor/piper-tts.js`, ohne einen externen ESM-CDN zur Laufzeit.
- **Die zwei freigegebenen deutschen Modelle** Thorsten medium und Thorsten high sowie die WASM-Laufzeiten laufen über die Worker-Routen `/api/piper-model/…` und `/api/piper-runtime/…`, um Probleme mit direkten Drittanbieter-Downloads auf mobilen Browsern zu verringern.
- `GET /api/piper-check` prüft mit HEAD-Anfragen, ob Cloudflare Modell-Metadaten und beide Laufzeitquellen erreichen kann. **Ein grüner Diagnosewert beweist nicht, dass Piper auf jedem Handy läuft oder dass komplette Modell-Downloads und Inferenz funktionieren.**
- Das Download-Modell kann über 60 MB groß sein und lokal zwischengespeichert werden. Mehrere Versuche benötigen ausreichend freies WLAN-Datenvolumen und Speicher. Die App zeigt getrennte Fehlermeldungen für den Bibliotheksdownload, Modell-/Laufzeitdownload und Synthese.
- Die Gerätestimme zum direkten Vorlesen bleibt ohne Piper-Bibliothek verfügbar, kann aber nicht in eine WAV-Datei exportiert werden.

## Technische Grenzen

- **WebM ist kein MP4.** Für Instagram oder Schnittprogramme kann eine Konvertierung erforderlich sein, zum Beispiel:

```bash
ffmpeg -i content.webm -c:v libx264 -pix_fmt yuv420p -c:a aac -movflags +faststart content.mp4
```

- Der Videoexport läuft im **aktuellen Browser-Tab in Echtzeit**. Tab offen und sichtbar halten; bei längeren Aufnahmen nicht sperren.
- Je nach Browser stehen WebM, Canvas Capture oder Audiomischung nicht zur Verfügung. Google Chrome auf modernen Android-/Desktop-Geräten ist die primäre Zielplattform.
- Medienclips werden als visuelle Quelle geschnitten, die **Original-Tonspur** eines hochgeladenen Clips wird derzeit nicht automatisch übernommen. Für Sprache eigene MP3/WAV-Datei hochladen oder eine WAV-Datei mit Piper erzeugen. Die Browser-Vorlesefunktion selbst ist **nicht** als Video-Audiospur exportierbar.
- Der Vorlagenmodus ist **keine generative KI**. Er benutzt vordefinierte Strukturen und die eigenen Themenangaben; nur mit konfigurierter API entstehen dynamisch formulierte KI-Skripte.
- Keine automatische Veröffentlichung, Trendsuche, Cloudspeicherung, MP4-Konvertierung oder vollständige Nutzung aller zehn aufgeführten GitHub-Tools in v1. Diese Funktionen sind Erweiterungen, nicht als fertig zu verstehen.
- Der Studio-Zugangsschlüssel ist eine einfache Einzelbenutzer-Schranke, **kein vollwertiges Konten-/Rollen- oder Rate-Limit-System**. Für öffentlichen Mehrbenutzerbetrieb zusätzlich Cloudflare Access, Quotas und Rate-Limits einrichten.

## Dateien

- `public/index.html`: Oberfläche
- `public/style.css`: Responsives Design
- `public/app.js`: Workflow, Medienverarbeitung, Browser-Export
- `public/core.js`: Textvorlagen, SRT-Erstellung
- `worker.js`: optionale serverseitige API-Anbindung
- `tests/core.test.mjs`: automatisierte Tests

## Datenschutz

Bild- und Videodateien bleiben bei der lokalen Verarbeitung im Browser; sie werden weder an den Cloudflare Worker noch an OpenAI übertragen. **Thema, Projektangaben und Sprechertext** werden bei aktivierter KI-Funktion an den konfigurierten API-Anbieter gesendet. Vor der Verarbeitung personenbezogener Kundendaten Einwilligung, Datenschutz und KI-Anbieterbedingungen prüfen.
