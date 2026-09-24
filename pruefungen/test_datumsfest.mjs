// Keine Pruefung darf am Kalender haengen.
//
// Am 22.08.2026 wurden zwei Pruefungen um Mitternacht rot, ohne dass sich am
// Produkt etwas geaendert hatte: In test_tagfilter.mjs stand '2026-08-21'
// fest im Text, und die Marke "heute" verschwand, als dieser Tag vorbei war.
//
// Ein Datum in den Testdaten ist harmlos, solange das Produkt es nicht mit
// HEUTE vergleicht -- ein Geburtsdatum von 1990 stoert nie. Gefaehrlich sind
// Daten NAHE beim heutigen Tag: Genau die werden mit "heute", "abgelaufen"
// oder "laeuft bald ab" verglichen und kippen beim Datumswechsel.
//
// Darum: Ein festes Datum innerhalb von 30 Tagen um heute ist eine
// Zeitbombe. Es gehoert aus dem heutigen Tag berechnet, nicht hingeschrieben.
import { readdirSync, readFileSync } from 'fs';
import { HIER } from './pfade.mjs';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const heute = Date.now();
const TAGE = 30;
const nah = d => Math.abs(new Date(d + 'T12:00:00Z').getTime() - heute) < TAGE * 864e5;

const dateien = readdirSync(HIER).filter(f => f.startsWith('test_') && f.endsWith('.mjs'));
const funde = {};

for (const f of dateien) {
  if (f === 'test_datumsfest.mjs') { continue; }
  const text = readFileSync(HIER + '/' + f, 'utf8');
  text.split('\n').forEach((zeile, i) => {
    // Kommentare zaehlen nicht -- dort steht die Erklaerung, warum es kein
    // festes Datum mehr gibt.
    if (/^\s*(\/\/|\*)/.test(zeile)) { return; }
    // Ein fester Kalendertag, den das Produkt nie mit heute vergleicht
    // (Zeitumstellung, Jahresende, Grenze eines Regelwerks), kippt nicht
    // beim Datumswechsel. Er wird auf seiner Zeile als "kalenderfest:" mit
    // Grund gekennzeichnet -- ohne Grund zaehlt die Kennzeichnung nicht.
    // Nur fuer einzelne Zeilen, nie fuer ganze Suiten: Die gehoeren in den
    // Grundstand unten, und der darf nicht wachsen.
    if (/\/\/\s*kalenderfest:\s*\S{3,}/.test(zeile)) { return; }
    for (const m of zeile.matchAll(/(20\d\d-[01]\d-[0-3]\d)/g)) {
      if (nah(m[1])) { (funde[f] = funde[f] || []).push(`${i + 1}: ${m[1]}`); }
    }
  });
}

// GRUNDSTAND vom 22.08.2026.
//
// Diese Suiten tragen schon feste Daten nahe beim heutigen Tag. Sie alle auf
// einmal umzuschreiben waere ein grosser Eingriff mit echtem Risiko -- und
// eine dauerhaft rote Pruefung ist schlimmer als keine: Wer sich an Rot
// gewoehnt, liest es nicht mehr.
//
// Darum: Diese Liste darf SCHRUMPFEN, nie wachsen. Eine NEUE Suite mit einem
// festen Datum nahe heute faellt sofort auf. Wer eine der genannten Suiten
// aufraeumt, streicht sie hier -- dann haelt die Pruefung den Fortschritt
// fest. (Offener Punkt im Projekt-Repository.)
const GRUNDSTAND = [
  'test_admin.mjs', 'test_anwenden.mjs', 'test_auslagen.mjs', 'test_bedarf.mjs',
  'test_dash.mjs', 'test_kunden.mjs', 'test_rollen.mjs', 'test_sprechen.mjs',
  'test_tagesplan_mobil.mjs', 'test_zweifaktor.mjs',
];

const neueSuiten = Object.keys(funde).filter(f => !GRUNDSTAND.includes(f)).sort();
check('KRITISCH: keine NEUE Suite nagelt ein Datum nahe beim heutigen Tag fest',
  neueSuiten.length === 0);
neueSuiten.forEach(f => bad.push(`festes Datum in ${f}: ${funde[f].join(', ')}`));

const totEintraege = GRUNDSTAND.filter(f => !dateien.includes(f));
check('Der Grundstand nennt nur Suiten, die es gibt', totEintraege.length === 0);
totEintraege.forEach(f => bad.push('Grundstand ohne Datei: ' + f));

const bereinigt = GRUNDSTAND.filter(f => !funde[f]);
check(`Grundstand: noch ${Object.keys(funde).length} von ${GRUNDSTAND.length} Suiten mit festem Datum`
    + (bereinigt.length ? ` — bereinigt, aus dem Grundstand streichen: ${bereinigt.join(', ')}` : ''),
  true);

console.log(bad.length ? `\n✓ ${ok.length} bestanden\n\n✗ ${bad.length} FEHLGESCHLAGEN:\n  - ${bad.join('\n  - ')}`
                       : `\n✓ ${ok.length} bestanden`);
process.exit(bad.length ? 1 : 0);
