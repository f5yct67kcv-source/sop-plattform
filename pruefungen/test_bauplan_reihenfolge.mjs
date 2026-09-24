// Der Bauplan legt eine FRISCHE Datenbank vollstaendig an -- in der
// Reihenfolge von kern_tabellen() (planung_einrichten_kern.php, Etappe
// "tabellen": foreach ueber den Katalog, eine Tabelle nach der anderen).
//
// WARUM DIESE SUITE: Beim ersten Mandanten-Vorrat (ENT-705) scheiterte die
// Einrichtung auf allen drei leeren Datenbanken an ereignis_meldung, errno
// 150: Sie verwies per Fremdschluessel auf objekt_aufgabe, und die stand im
// Katalog dahinter. Bestehende Anlagen merkten es nie -- dort gab es beide
// Tabellen schon, als der Verweis dazukam. Jede neue Anlage (Vorrat, Demo
// nach Neuaufbau, zweiter Mandant) haette es getroffen.
//
// Geprueft wird die Aussage: Jede Tabelle, auf die eine andere verweist,
// steht im Katalog VOR ihr. Nicht eine Liste bekannter Paare.
import { WURZEL } from './pfade.mjs';
import { readFileSync } from 'fs';
import { join } from 'path';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const kern = readFileSync(join(WURZEL, 'backend/planung_einrichten_kern.php'), 'utf8');
const anfang = kern.indexOf('function kern_tabellen()');
const katalog = kern.slice(anfang, kern.indexOf('\n}', anfang));

// Jeder Eintrag: 'name' => "CREATE TABLE ... ", bis zum schliessenden ",
const eintraege = [...katalog.matchAll(/^'(\w+)' => "([\s\S]*?)",\s*$/gm)]
  .map(m => ({ name: m[1], sql: m[2].replace(/--[^\n]*/g, '') }));
const stelle = new Map(eintraege.map((e, i) => [e.name, i]));

check(`der Katalog ist auffindbar (${eintraege.length} Tabellen)`, eintraege.length > 50);
check('KRITISCH: jede Katalogtabelle wird mit CREATE TABLE angelegt',
  eintraege.every(e => /CREATE TABLE/i.test(e.sql)));

const zuFrueh = [], unbekannt = [];
eintraege.forEach((e, i) => {
  for (const [, ziel] of e.sql.matchAll(/REFERENCES\s+`?(\w+)`?/gi)) {
    if (ziel === e.name) { continue; }
    if (!stelle.has(ziel)) { unbekannt.push(`${e.name} -> ${ziel}`); continue; }
    if (stelle.get(ziel) > i) { zuFrueh.push(`${e.name} -> ${ziel}`); }
  }
});
const verweise = eintraege.reduce((n, e) => n + [...e.sql.matchAll(/REFERENCES/gi)].length, 0);
check(`es gibt ueberhaupt Fremdschluessel im Katalog (${verweise})`, verweise > 20);
check('KRITISCH: jede Tabelle, auf die verwiesen wird, steht im Katalog davor'
  + (zuFrueh.length ? ` — zu frueh: ${zuFrueh.join(', ')}` : ''), zuFrueh.length === 0);
check('jeder Verweis zeigt auf eine Tabelle des Katalogs'
  + (unbekannt.length ? ` — unbekannt: ${unbekannt.join(', ')}` : ''), unbekannt.length === 0);

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
