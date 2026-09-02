// Die Ablauf-Logik des Prueflaeufers (ENT-310).
//
// Wozu eine eigene Suite fuer das Pruefwerkzeug: Der Laeufer ist das Netz,
// an dem alles andere haengt. Ein Fehler DARIN meldet gruen, wo rot waere --
// und das faellt niemandem auf, weil man ja auf ihn schaut, um es zu
// erfahren. Genau deshalb steht die Entscheidungslogik in lauf.mjs, ohne
// Browser und ohne Dateien: damit sie sich in Sekunden pruefen laesst.
//
// Geprueft wird mit erfundenen "Suiten" -- Funktionen, die eine Weile
// brauchen und ein Ergebnis liefern. Kein echter Browser, keine echte
// Zeitmessung; nur die Frage, ob der Laeufer tut, was er verspricht.
import { poolLauf, mitWiederholung } from './lauf.mjs';
import { readFileSync } from 'fs';
import { WURZEL } from './pfade.mjs';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);
const warte = ms => new Promise(r => setTimeout(r, ms));

// ══════════ GRENZE WIRD EINGEHALTEN ═══════════════════════════════════
// Ohne Begrenzung startet ein voller Lauf 95 Browser gleichzeitig und misst
// danach den Arbeitsspeicher, nicht die Software.
{
  let laufend = 0, hoechstGesehen = 0;
  const namen = Array.from({ length: 20 }, (_, i) => 'suite' + i);
  const { ergebnisse, hoechststand } = await poolLauf(namen, async () => {
    laufend++;
    if (laufend > hoechstGesehen) { hoechstGesehen = laufend; }
    await warte(5);
    laufend--;
    return { gruen: true };
  }, 4);
  check('KRITISCH: es laufen nie mehr als die erlaubte Zahl gleichzeitig',
    hoechstGesehen <= 4);
  check('Die Bahnen werden auch wirklich ausgenutzt, nicht nur eine',
    hoechstGesehen > 1);
  check('KRITISCH: jede Suite wird genau einmal ausgefuehrt',
    ergebnisse.length === 20 && ergebnisse.every(e => e && e.gruen));
  check('Der gemeldete Hoechststand stimmt mit dem tatsaechlichen ueberein',
    hoechststand === hoechstGesehen);
}

// ══════════ REIHENFOLGE DER ERGEBNISSE ════════════════════════════════
// Die Ergebnisse muessen in der Reihenfolge der EINGABE zurueckkommen, nicht
// in der des Fertigwerdens -- sonst sieht jeder Lauf anders aus und laesst
// sich mit dem vorherigen nicht vergleichen.
{
  const namen = ['a', 'b', 'c', 'd'];
  // b braucht am laengsten, a am kuerzesten: die Fertig-Reihenfolge ist
  // garantiert eine andere als die Eingabe-Reihenfolge.
  const dauer = { a: 1, b: 40, c: 5, d: 10 };
  const fertigReihe = [];
  const { ergebnisse } = await poolLauf(namen, async n => {
    await warte(dauer[n]);
    return { gruen: true, wer: n };
  }, 4, n => fertigReihe.push(n));
  check('KRITISCH: die Ergebnisse stehen in der Reihenfolge der Eingabe',
    ergebnisse.map(e => e.wer).join('') === 'abcd');
  check('Die Fortschrittsanzeige meldet dagegen in der Reihenfolge des Fertigwerdens',
    fertigReihe.join('') !== 'abcd' && fertigReihe.length === 4);
}

// ══════════ EINE BAHN VERHAELT SICH WIE VORHER ════════════════════════
{
  let gleichzeitig = 0, hoechst = 0;
  const namen = ['x', 'y', 'z'];
  const reihe = [];
  await poolLauf(namen, async n => {
    gleichzeitig++; if (gleichzeitig > hoechst) { hoechst = gleichzeitig; }
    await warte(3);
    gleichzeitig--; reihe.push(n);
    return { gruen: true };
  }, 1);
  check('KRITISCH: mit einer Bahn laeuft alles streng nacheinander (--seriell)',
    hoechst === 1 && reihe.join('') === 'xyz');
}

// ══════════ RANDFAELLE ════════════════════════════════════════════════
{
  const { ergebnisse } = await poolLauf([], async () => ({ gruen: true }), 4);
  check('Eine leere Liste laeuft durch, statt haengen zu bleiben', ergebnisse.length === 0);
}
{
  // Mehr Bahnen als Suiten darf nicht dazu fuehren, dass leere Bahnen
  // ewig auf Arbeit warten.
  const { ergebnisse } = await poolLauf(['nur-eine'], async () => ({ gruen: true }), 8);
  check('Mehr Bahnen als Suiten ist kein Problem', ergebnisse.length === 1);
}
{
  // Wirft eine Suite unerwartet, darf der ganze Lauf nicht stehenbleiben --
  // sonst haengt die Regression und niemand weiss, woran.
  let durchgelaufen = false;
  try {
    await poolLauf(['a', 'b'], async n => {
      if (n === 'a') { throw new Error('kaputt'); }
      return { gruen: true };
    }, 2);
  } catch {
    durchgelaufen = true;
  }
  check('Ein unerwarteter Fehler bleibt sichtbar, statt still verschluckt zu werden',
    durchgelaufen);
}

// ══════════ WIEDERHOLUNG ROTER SUITEN ═════════════════════════════════
// Der Kern des Umbaus: Parallelbetrieb kann Fehlschlaege erzeugen, die es
// allein nicht gibt. Ohne Wiederholung gewoehnt man sich an rote Laeufe --
// und uebersieht den echten.
{
  const versuche = [];
  const { echt, wackelig } = await mitWiederholung(['flatterhaft', 'wirklich-kaputt'],
    async n => {
      versuche.push(n);
      return { gruen: n === 'flatterhaft' };
    });
  check('KRITISCH: was allein besteht, gilt nicht als rot',
    wackelig.length === 1 && wackelig[0].name === 'flatterhaft');
  check('KRITISCH: was auch allein scheitert, bleibt rot',
    echt.length === 1 && echt[0].name === 'wirklich-kaputt');
  check('Jede verdaechtige Suite wird genau einmal wiederholt',
    versuche.length === 2);
}
{
  // Bei gruenem Durchgang darf die Wiederholung nichts kosten.
  let aufrufe = 0;
  await mitWiederholung([], async () => { aufrufe++; return { gruen: true }; });
  check('Ohne rote Suite wird nichts wiederholt', aufrufe === 0);
}

// ══════════ DER LAEUFER SELBST ════════════════════════════════════════
const ALLE = readFileSync(`${WURZEL}/pruefungen/alle.mjs`, 'utf8');

check('KRITISCH: der Laeufer laesst keine Suite aus -- er liest weiterhin das ganze Verzeichnis',
  /readdirSync\(HIER\)/.test(ALLE)
  && /startsWith\('test_'\)/.test(ALLE) && /endsWith\('\.mjs'\)/.test(ALLE));
check('KRITISCH: ein roter Lauf endet weiterhin mit Ende-Code 1',
  /process\.exit\(1\)/.test(ALLE));
check('KRITISCH: rote Suiten werden vor dem Urteil einzeln wiederholt',
  /mitWiederholung\(/.test(ALLE));
// Sonst verdeckt die Wiederholung genau die Unzuverlaessigkeit, die sie
// sichtbar machen soll.
check('KRITISCH: eine nur parallel rote Suite wird GEMELDET, nicht stillschweigend geschluckt',
  /wackelig\.length/.test(ALLE) && /Nur im parallelen Lauf rot/.test(ALLE));
check('Es gibt einen Weg zurueck zum seriellen Lauf, um so etwas nachzustellen',
  /--seriell/.test(ALLE));
check('Die Warnung vor dem Schieben bei Rot steht weiterhin da',
  /Nicht schieben, solange etwas rot ist/.test(ALLE));
// Ein grosser Rechner soll nicht 32 Browser gleichzeitig oeffnen.
check('Die Zahl der Bahnen ist nach oben begrenzt',
  /Math\.min\(4,/.test(ALLE));

// ══════════ KEIN GETEILTER ZUSTAND ZWISCHEN SUITEN ════════════════════
// Parallelbetrieb deckt auf, was sequenziell harmlos war: zwei Suiten, die
// dieselbe Datei anlegen. Genau das gab es (OUT/testbild.png).
{
  const { readdirSync } = await import('fs');
  const dateien = readdirSync(`${WURZEL}/pruefungen`).filter(f => f.startsWith('test_'));
  const ziele = new Map();
  for (const f of dateien) {
    const inhalt = readFileSync(`${WURZEL}/pruefungen/${f}`, 'utf8');
    for (const m of inhalt.matchAll(/OUT\s*\+\s*'\/([a-zA-Z0-9._-]+)'/g)) {
      if (!ziele.has(m[1])) { ziele.set(m[1], []); }
      if (!ziele.get(m[1]).includes(f)) { ziele.get(m[1]).push(f); }
    }
  }
  const doppelt = [...ziele.entries()].filter(([, wer]) => wer.length > 1);
  check('KRITISCH: keine zwei Suiten legen dieselbe Datei an'
    + (doppelt.length ? ' -- doppelt: ' + doppelt.map(([d]) => d).join(', ') : ''),
    doppelt.length === 0);
}

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
