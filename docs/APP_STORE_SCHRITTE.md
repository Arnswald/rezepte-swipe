# App Store: Was Christian selbst tun muss

Stand 04.11.2026. Plan und Begründung: `~/ai/agent-cluster/docs/konzepte/KONZEPT_Rezepte_App_Store.md`.
Branch `app-store-20261103`. Nichts davon ist gekauft, signiert oder hochgeladen.

## Was schon da ist

- iOS-Hülle (Capacitor 8) in `ios/`, App-ID `de.christianarns.rezepte`, Name „Rezepte“. Sie lädt die Live-Seite (`capacitor.config.ts`, `server.url`).
- Native Funktionen: Haptik beim Wischen, Bildschirm bleibt im offenen Rezept an, natives Teilen-Menü.
- Konto löschen (Profil), `/datenschutz`, Sitzungs-Token statt nackter guestId.

## Was du tun musst (in dieser Reihenfolge)

1. **Entscheiden:** nur TestFlight für Freunde oder öffentlich im Store. TestFlight intern (bis 100 Personen) braucht keine Prüfung durch App Review.
2. **Apple Developer Program** beitreten (developer.apple.com/programs). Preis vorher dort prüfen (Plan nennt 99 USD/Jahr aus Zweitquelle). Privat oder über Firma entscheidet den Anbieternamen im Store (Firma braucht D-U-N-S-Nummer).
3. **Kontakt eintragen:** in `src/app/datenschutz/page.tsx` die Konstante `KONTAKT` (steht auf `[Kontakt eintragen]`). Dann Web-App neu ausrollen (Portainer), damit `https://rezepte.christianarns.de/datenschutz` live ist. Ohne das geht die Hülle nicht in die Prüfung.
4. **Backend ausrollen:** die neuen Routen (`DELETE /api/me`, `DELETE /api/session`, Sitzungs-Cookie) müssen live sein, bevor die App im Store ist. Tabelle `sessions` legt die App beim ersten Start selbst an.
5. **App-Icon:** 1024x1024 PNG ohne Transparenz in `ios/App/App/Assets.xcassets/AppIcon.appiconset/` ersetzen. Vorlage liegt in `tools/icon/ios-symbol-1024.png` (prüfen, ob das das gewünschte Icon ist).
6. **Xcode (selbst öffnen):** `ios/App/App.xcodeproj`. Unter Signing & Capabilities: Team wählen (dein Developer-Konto), „Automatically manage signing“ an. Bundle Identifier `de.christianarns.rezepte` prüfen (muss in deinem Konto frei sein).
7. **Auf echtem iPhone testen** (Apple verlangt getestete Version): Wischen mit Haptik, Rezept offen lässt den Bildschirm an, Teilen-Menü, Registrieren, Konto löschen, `/admin` zeigt in der App nur „nur im Browser“.
8. **App Store Connect** (appstoreconnect.apple.com): App anlegen mit derselben Bundle-ID.
   - **Datenschutzangaben (App Privacy):** Daten „mit Nutzer verknüpft“: Name/Benutzername, Nutzer-ID, Nutzerinhalte (Bewertungen, eingereichte Rezepte), Fotos/Audio nur wenn eingereicht. Zweck: App-Funktionalität. Kein Tracking, keine Werbung.
   - **Datenschutz-URL:** `https://rezepte.christianarns.de/datenschutz`
   - **Demo-Konto** für den Prüfer anlegen (Benutzername und Passwort in die Review-Hinweise) und dafür sorgen, dass der Server läuft.
   - **Review-Hinweise:** Einreichungen von Gästen werden vor Veröffentlichung von dir geprüft (Guideline 1.2), Konto löschen unter Profil, Verwaltung gibt es nur im Browser.
   - Screenshots iPhone (6,9 Zoll), Beschreibung, Altersfreigabe, Kategorie „Essen & Trinken“.
9. **Archive und Upload:** in Xcode Product › Archive, dann Distribute App › App Store Connect. Danach TestFlight: intern sofort, extern nach Beta-Prüfung.

## Wenn du die Hülle neu bauen willst

```
npm install
npx cap sync ios
```
Dann in Xcode öffnen. Wer die Web-App ändert, muss die Hülle nicht neu bauen (sie lädt die Live-Seite).

## Bekannte Risiken

- **Simulator-Build nicht geprüft:** `xcodebuild` (Xcode 27.2, ohne Signierung) hing beim Laden des Swift-Pakets `capacitor-swift-pm` und meldete „CoreSimulator is out of date (1174.9.2 < 1174.21.0)“. Das liegt am Mac, nicht am Projekt: Xcode einmal öffnen und die angebotenen Komponenten installieren, dann in Xcode einmal bauen (Run auf einem Simulator).

- **Guideline 4.2** („nur eine Webseite“): Die Hülle lädt die Live-URL. Dagegen stehen drei native Funktionen. Ein Erfolg ist nicht garantiert. Plan B: Frontend bündeln (Plan Abschnitt 7, Schritt 3) oder weitere native Funktionen (lokale Erinnerung, Offline-Cache).
- Fällt der Server aus, zeigt die App „Keine Verbindung“ (`app-shell/offline.html`).
- Sitzungen: alte Geräte werden beim nächsten Öffnen automatisch umgestellt. Erst wenn alle umgestellt sind, kann man in Portainer `SESSION_ENFORCE=1` setzen (dann zählt die alte guestId allein nicht mehr).
  - Token aus der stillen Umstellung stehen mit `via = 'migration'` in `sessions` (normale Anmeldungen: `via = 'login'`). Konten bekommen Tokens nur über Login/Register, und ein Gast mit Sitzung oder Konto wird bei Body-guestId abgewiesen (401).
  - **Bereinigung vor `SESSION_ENFORCE=1` (nicht automatisch, von Hand ausführen, vorher Datenbank sichern):** Tokens, die vor diesem Fix über `/api/me` an Konten gingen, sind nicht von echten zu unterscheiden (Spalte `via` gab es noch nicht, sie steht dort auf `login`). Sicherster Weg: alle Sitzungen von Konten verwerfen, die Nutzer melden sich einmal neu an:
    `DELETE FROM sessions WHERE guest_id IN (SELECT guest_id FROM accounts);`
    Dazu die Migrations-Sitzungen von Konten (neue Zeilen vor dem Umschalten): `DELETE FROM sessions WHERE via = 'migration' AND guest_id IN (SELECT guest_id FROM accounts);`
  - Ändernde API-Aufrufe prüft `src/proxy.ts` auf den Origin-Header (gleiche Herkunft, `capacitor://localhost`, `https://rezepte.christianarns.de`; weitere über `ALLOWED_ORIGINS`, Komma-getrennt). Ändert sich `server.url`, `src/lib/origin.ts` anpassen.
