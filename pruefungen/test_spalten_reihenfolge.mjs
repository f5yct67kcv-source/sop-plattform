// Nachgetragene Spalten: Reihenfolge der ALTER-Liste.
//
// WARUM DIESE SUITE
//
// Am 2026-09-23 scheiterte der Einrichtungslauf im Cockpit an jedem Mandanten:
// beleg_fassung.versendet_von_id wurde "AFTER freigegeben" angelegt, die
// Spalte freigegeben stand aber erst eine Zeile SPAETER in kern_spalten().
// Auf einer frischen Datenbank faellt das nicht auf -- dort legt CREATE TABLE
// beide Spalten an und die Liste wird uebersprungen. Es trifft nur eine
// Datenbank, die die Tabelle schon in einem aelteren Stand hat, also genau
// die produktive.
//
// Die Regel: Wird eine Spalte "AFTER x" angelegt und traegt dieselbe Liste
// auch x fuer dieselbe Tabelle nach, muss der Eintrag fuer x davor stehen.
// Geprueft fuer beide Listen: kern_spalten() (Cockpit) und be_spalten()
// (Betreiber).
import { WURZEL } from './pfade.mjs';
import { readFileSync } from 'fs';
import { join } from 'path';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

// Eintraege der Form ['tabelle', 'spalte', "ALTER TABLE ... AFTER x ..."].
// Der Befehl kann ueber zwei Zeilen gehen (mit . verkettet); fuer AFTER
// genuegt der erste Teil, der steht immer in derselben Zeile wie der Name.
function eintraege(quelle) {
  const re = /\[\s*'([a-z_]+)',\s*'([a-z_]+)',\s*(?:"(ALTER TABLE [^"]*)"|'(ALTER TABLE [^']*)')/g;
  return [...quelle.matchAll(re)].map((m, i) => ({
    i, tab: m[1], spalte: m[2],
    nach: ((m[3] ?? m[4]).match(/ADD COLUMN [a-z_]+ [^,]*?\bAFTER ([a-z_]+)/) || [])[1] || null,
  }));
}

function fehlerIn(liste) {
  const fehler = [];
  for (const e of liste) {
    if (!e.nach) continue;
    const vorgaenger = liste.find(x => x.tab === e.tab && x.spalte === e.nach);
    if (vorgaenger && vorgaenger.i > e.i) {
      fehler.push(`${e.tab}.${e.spalte} kommt AFTER ${e.nach}, das erst spaeter nachgetragen wird`);
    }
  }
  return fehler;
}

function pruefe(name, liste) {
  check(`${name}: Liste gefunden (${liste.length} Eintraege)`, liste.length > 20);
  const fehler = fehlerIn(liste);
  check(`KRITISCH: ${name}: jede Spalte steht hinter einer, die es dann schon gibt`
    + (fehler.length ? ' -- ' + fehler.join('; ') : ''), fehler.length === 0);
}

const kern = readFileSync(join(WURZEL, 'backend/planung_einrichten_kern.php'), 'utf8');
const kernListe = kern.slice(kern.indexOf('function kern_spalten()'), kern.indexOf('function kern_spalten_breite()'));
pruefe('Cockpit (kern_spalten)', eintraege(kernListe));

const be = readFileSync(join(WURZEL, 'backend/betreiber.php'), 'utf8');
pruefe('Betreiber (be_spalten)', eintraege(be));

// GEGENPROBE: der Fehler vom 2026-09-23, nachgestellt -- muss anschlagen.
const kaputt = `
    ['beleg_fassung', 'versendet_von_id', 'ALTER TABLE beleg_fassung ADD COLUMN versendet_von_id INT NULL AFTER freigegeben'],
    ['beleg_fassung', 'freigegeben', 'ALTER TABLE beleg_fassung ADD COLUMN freigegeben TINYINT(1) NOT NULL DEFAULT 0 AFTER versendet_von'],`;
const k = eintraege(kaputt);
check('GEGENPROBE: die vertauschte Reihenfolge wird erkannt', k.length === 2 && fehlerIn(k).length === 1);
check('GEGENPROBE: richtig herum ist sie in Ordnung', fehlerIn(eintraege(kaputt.split('\n').reverse().join('\n'))).length === 0);

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
