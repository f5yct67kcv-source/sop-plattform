// Keine echten Personen- und Kundennamen in den Testdaten.
//
// CLAUDE.md: "Keine echten Kunden-, Objekt- oder Personennamen -- nicht im
// Code, nicht in Testdaten." Die Regel stand da, wurde aber von nichts
// bewacht: Bis 2026-09-01 trugen 24 Pruefdateien echte Firmen, Gemeinden
// und Nachnamen, dazu drei Platzhaltertexte im Dashboard und die
// Beispielwerte in backend/ai.php -- letztere gingen bei JEDER Anfrage ans
// Sprachmodell.
//
// Warum eine Erlaubnisliste und keine Sperrliste: Eine Liste der zu
// vermeidenden echten Namen muesste die echten Namen enthalten. Sie waere
// genau das Dokument, das hier nicht entstehen darf. Geprueft wird darum
// umgekehrt -- ein Nachname oder Kundenname in den Testdaten muss als
// Platzhalter erkennbar sein.
//
// Bewusst NICHT geprueft: Vornamen. Ein Vorname allein benennt niemanden,
// und eine Pflicht zu "Vorname: Muster" haette nur Rauschen erzeugt. Wer
// einen echten Vor- UND Nachnamen einsetzt, scheitert am Nachnamen.
//
// NACHTRAG 2026-09-01: objekt_name kam dazu, nachdem der Waechter einen
// echten Objektnamen durchgelassen hat. Eine parallele Sitzung brachte
// beim Bau von ENT-294/295 Fixtures aus einer Fassung VOR der Bereinigung
// zurueck ins Repository -- den Kundennamen fing diese Pruefung ab, den
// Objektnamen daneben nicht, weil sie nur zwei Feldnamen kannte. Gefunden
// wurde er erst beim Abgleich mit der Entfernungsliste aus ENT-288.
// Die Lehre ist nicht "mehr Feldnamen aufzaehlen", sondern dass diese
// Pruefung nur so weit reicht, wie ihre Feldliste -- was ausserhalb steht,
// sieht sie nicht. Ein echter Name in einer Ueberschrift faellt weiterhin
// durch.
import { readdirSync, readFileSync } from 'fs';
import { HIER } from './pfade.mjs';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

// Ein Wert gilt als Platzhalter, wenn er eine dieser Marken traegt. Sie
// sind die im Bestand gewachsene Konvention, nicht neu erfunden.
// 'objekt' kam mit der Ausweitung auf objekt_name dazu: Die Objekt-Fixtures
// im Haus heissen durchgehend "Objekt Nord", "Objekt A", "Objekt Mit" --
// eine gewachsene Konvention, kein neu erfundener Freibrief.
// 'cupi' stand hier, solange CUPI 24 als eigener Betrieb galt (ENT-008).
// Seit ENT-568 ist sie Mandantin, also Kundin, und ihr Name ist kein
// Platzhalter mehr -- siehe die Pruefung auf die Mandantin weiter unten.
const MARKEN = /muster|beispiel|test|fremd|kunde|probe|objekt|nordbau|grossbau|techmuster|werkmuster|abc /i;

// Werte, die keine Namen sind, sondern Beschriftungen und Zustaende: Sie
// stehen in Namensfeldern, weil die Pruefung dort eine Zeile wiedererkennen
// will. Diese Liste enthaelt ausdruecklich KEINE echten Namen -- kommt ein
// Eintrag dazu, gehoert er begruendet.
const KEINE_NAMEN = new Set([
  'Abgeschlossen', 'Bereits abgeglichen', 'Diktiert', 'Fest', 'Kurzeinsatz',
  'Leitung', 'Mitarbeit', 'Nachname', 'Person', 'Planung',
  'Rückmeldungen', 'Vergangen, nicht abgeschlossen', 'Wächterin',
  'Allein GmbH', 'Einmal AG', 'Einzelkunde AG', 'Nah AG', 'Objekt AG',
  'Reihe AG', 'Nur Ort AG', 'Eine sehr sehr lange Kundenbezeichnung AG',
  'Einwohnergemeinde Musterdorf', 'Gemeinde Beispieldorf', 'Gemeinde Musterdorf',
  // Beschreibung eines Gebaeudetyps samt Himmelsrichtung, kein Eigenname.
  // ENT-288 hat an derselben Zeile den KUNDEN ersetzt und diesen Objektnamen
  // ausdruecklich stehen lassen -- die Einordnung ist also nicht neu.
  'Einkaufszentrum Nord', 'Einkaufszentrum Nord West',
]);

const dateien = readdirSync(HIER).filter(f => f.startsWith('test_') && f.endsWith('.mjs'));
const funde = {};

for (const f of dateien) {
  if (f === 'test_namensfrei.mjs') { continue; }
  const text = readFileSync(HIER + '/' + f, 'utf8');
  for (const m of text.matchAll(/(nachname|kunde_name|objekt_name)\s*:\s*'([^']*)'/g)) {
    const wert = m[2].trim();
    // Leere Werte und Einzelbuchstaben pruefen nichts und benennen niemanden.
    if (wert.length < 2) { continue; }
    if (MARKEN.test(wert) || KEINE_NAMEN.has(wert)) { continue; }
    (funde[f] = funde[f] || []).push(wert);
  }
}

const betroffen = Object.keys(funde).sort();
check('KRITISCH: kein Nachname und kein Kundenname in den Testdaten sieht nach einem echten aus',
  betroffen.length === 0);
betroffen.forEach(f => bad.push(`${f}: ${[...new Set(funde[f])].join(', ')}`));

check(`Geprueft: ${dateien.length - 1} Suiten auf Namensfelder`, dateien.length > 1);

// ── Die Mandantin als Firma oder Kontakt (ENT-568) ────────────────────
//
// Die Feldpruefung oben sieht nur Namensfelder. Die Mandantin stand aber
// auch im Briefkopf, in Fusszeilen, als Absender und in E-Mail-Adressen --
// ueberall dort, wo eine Testfirma gebraucht wurde, war es ihre.
//
// Geprueft wird die Mandantin als FIRMA (mit Rechtsform) und als KONTAKT
// (ihre Domain). Ihr Kurzname als technische Kennung bleibt erlaubt: Das
// Deploy-Buendel und die Subdomain heissen so, und Pruefungen, die den
// Deploy nachmessen, muessen sie nennen koennen. Ihre Adresse und UID
// stehen hier bewusst NICHT -- diese Pruefung soll nicht selbst das
// Dokument werden, das die Daten enthaelt.
const MANDANTIN = /cupi\s?24\s*(gmbh|ag)\b|@cupi24\b|cupi24\.ch\b/i;
const alleDateien = readdirSync(HIER)
  .filter(f => /^(test_|pruef_).*\.(mjs|php)$/.test(f) && f !== 'test_namensfrei.mjs');
const mandantFunde = alleDateien.filter(f => MANDANTIN.test(readFileSync(HIER + '/' + f, 'utf8')));
check('KRITISCH: die Mandantin steht in keinen Testdaten als Firma oder Kontakt',
  mandantFunde.length === 0);
mandantFunde.forEach(f => bad.push(`Mandantin als Firma oder Kontakt in ${f}`));

console.log(bad.length ? `\n✓ ${ok.length} bestanden\n\n✗ ${bad.length} FEHLGESCHLAGEN:\n  - ${bad.join('\n  - ')}`
                       : `\n✓ ${ok.length} bestanden`);
process.exit(bad.length ? 1 : 0);
