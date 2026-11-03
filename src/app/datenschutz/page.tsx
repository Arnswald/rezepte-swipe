import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

export const metadata: Metadata = {
  title: "Datenschutz — Rezepte",
  description: "Welche Daten die Rezepte-App speichert, wofür, wo, und wie du sie löschst.",
};

// Statische Seite; Platzhalter [Kontakt eintragen] vor der Veröffentlichung im Store ersetzen.
const KONTAKT = "[Kontakt eintragen]";

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="text-base font-extrabold text-text-primary mt-7 mb-2">{children}</h2>;
}

export default function Datenschutz() {
  return (
    <main className="min-h-[100dvh] p-6 pb-16" style={{ background: "var(--bg)", color: "var(--text-primary)" }}>
      <div className="max-w-xl mx-auto text-sm leading-relaxed text-text-secondary">
        <Link href="/" className="inline-flex items-center gap-1 text-accent font-semibold mb-4">
          <ChevronLeft className="w-4 h-4" /> Zur App
        </Link>
        <h1 className="text-2xl font-extrabold text-text-primary tracking-tight">Datenschutz</h1>
        <p className="mt-2">Stand: 03.11.2026. Die App ist ein privates Hobbyprojekt, kein Unternehmen. Sie speichert so wenig wie möglich.</p>

        <H>Wer ist verantwortlich?</H>
        <p>Christian Arns, Köln. Kontakt: {KONTAKT}</p>

        <H>Welche Daten speichern wir?</H>
        <ul className="list-disc pl-5 space-y-1.5">
          <li><b>Konto:</b> dein Benutzername und dein Passwort. Das Passwort liegt nur als Hash (scrypt) auf dem Server, nie im Klartext. Eine E-Mail-Adresse brauchen wir nicht.</li>
          <li><b>Deine Bewertungen:</b> welche Gerichte du nach rechts, links oder hoch gewischt hast (mit Tag), deine Sterne nach dem Kochen, Zutaten, die du nicht magst, und dein Koch-Verlauf (optional mit einer Person, mit der du gekocht hast).</li>
          <li><b>Freunde und Gruppen:</b> dein Freundescode, deine Verbindungen und Gruppen-Mitgliedschaften. Verbundene Personen sehen, welche Gerichte ihr beide mögt.</li>
          <li><b>Eingereichte Rezepte:</b> Text, Link, Foto oder Sprachnachricht, die du selbst einreichst, samt deinem Namen als Absender.</li>
          <li><b>Sitzung:</b> ein zufälliges Anmelde-Token (als Cookie bzw. im Gerät), damit du angemeldet bleibst. Auf dem Server liegt davon nur ein Hash.</li>
          <li><b>Auf deinem Gerät:</b> Kopien deiner Bewertungen und Einstellungen im lokalen Speicher, damit die App schnell ist und offline Wischen nachholt.</li>
        </ul>
        <p className="mt-2">Keine Werbung, kein Tracking, keine Analyse-Dienste, keine Weitergabe an Dritte zu Werbezwecken.</p>

        <H>Wofür?</H>
        <p>Nur für die Funktion der App: deine Auswahl wiederfinden (auch auf einem anderen Gerät), Treffer mit Freunden anzeigen, ein Ranking beliebter Gerichte, und damit der Betreiber die eingereichten Rezepte prüfen kann. Rechtsgrundlage ist die Nutzung der App, die du selbst startest (Art. 6 Abs. 1 lit. b DSGVO).</p>

        <H>Wo liegen die Daten, wer sieht sie?</H>
        <p>Auf einem eigenen Server des Betreibers. Der Zugriff läuft verschlüsselt (HTTPS) über einen Tunnel von Cloudflare, der dabei technisch Verbindungsdaten (zum Beispiel die IP-Adresse) verarbeitet. Der Betreiber sieht in einer geschützten Auswertung, welche Person welche Gerichte mag. Eingereichte Links, Texte und Sprachnachrichten werden automatisch ausgelesen und dafür an einen KI-Dienst zur Texterkennung weitergegeben, bevor der Betreiber sie prüft.</p>

        <H>Wie lange?</H>
        <p>Bis du dein Konto löschst. Anmelde-Tokens laufen nach spätestens einem Jahr ab.</p>

        <H>Konto und Daten löschen</H>
        <p>In der App unter <b>Profil › Konto löschen</b>. Das löscht dein Konto sofort und endgültig mit allen Bewertungen, Sternen, Abneigungen, dem Koch-Verlauf, Verbindungen und Gruppen-Mitgliedschaften. Eingereichte Rezepte bleiben im Kochbuch, aber ohne Verbindung zu dir. Du kannst die Löschung auch per Nachricht an den Kontakt oben verlangen.</p>

        <H>Deine Rechte</H>
        <p>Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit und Widerspruch nach DSGVO. Du kannst dich außerdem bei einer Datenschutzaufsichtsbehörde beschweren.</p>
      </div>
    </main>
  );
}
