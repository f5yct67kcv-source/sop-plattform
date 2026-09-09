// KREUZPRUEFUNG DER BEIDEN ZEITKERNE (ENT-451, Etappe 3).
//
// Seit dem Lohnlauf gibt es die GAV-Zeitrechnung ZWEIMAL: als lesbare
// Quelle in `gav.js` (Browser) und noch einmal in `backend/gavzeit.php`
// (Server). Das ist eine bewusste Ausnahme von ENT-049 -- ein Lohnlauf darf
// seine Zahlen nicht aus dem Browser beziehen.
//
// DIESE PRUEFUNG IST DER PREIS DAFUER. Sie rechnet mehrere tausend Faelle
// durch BEIDE Fassungen und vergleicht Wert fuer Wert. Laufen sie
// auseinander, wird sie rot und nennt den ersten abweichenden Fall mit
// allen Eingaben.
//
// Sie prueft NICHT, ob die Regel richtig ist -- das tun pruef_lohn.php und
// die GAV-Suiten. Sie prueft, ob beide Fassungen DASSELBE sagen. Eine
// GAV-Revision, die nur an einer Stelle nachgezogen wird, faellt hier auf.
//
// Die Faelle sind erzeugt, nicht von Hand gewaehlt: Handverlesene Faelle
// treffen genau die Stellen, an die man beim Schreiben gedacht hat.
import { WURZEL } from './pfade.mjs';
import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

// ── Die JS-Fassung in Node laden ─────────────────────────────────────────
// gav.js ist kein Modul; der Quelltext wird ausgefuehrt und die gesuchten
// Funktionen werden zurueckgegeben. Kein Browser noetig -- der Zeitkern
// fasst kein DOM an.
const quelle = readFileSync(`${WURZEL}/gav.js`, 'utf8');
let js;
try {
  js = new Function(quelle + `
    ; return { gavRohMin, gavNetto, gavBonusMin, gavPauseSoll, gavGilt, gavStd };`)();
  check('Der Zeitkern aus gav.js laesst sich ausserhalb des Browsers ausfuehren', true);
} catch (e) {
  check('Der Zeitkern aus gav.js laesst sich ausserhalb des Browsers ausfuehren: ' + e.message, false);
}

// ── Faelle erzeugen ──────────────────────────────────────────────────────
// Bewusst breit gestreut, mit den Stellen, an denen eine Zeitrechnung
// erfahrungsgemaess bricht:
//  - jeder Wochentag, damit das Sonntagsfenster wirklich getroffen wird
//  - beide Sommerzeitwechsel 2026 (29.03. und 25.10.)
//  - Schichten ueber Mitternacht, also von Samstag in den Sonntag und
//    vom Sonntag in den Montag
//  - der Fensterrand 23:00 und 06:00 auf die Minute genau
//  - Pausen laenger als die Schicht (Erfassungsfehler)
const DATEN = [
  '2026-03-02', // Montag
  '2026-03-07', // Samstag
  '2026-03-08', // Sonntag
  '2026-03-28', // Samstag vor der Zeitumstellung
  '2026-03-29', // Sonntag, Beginn der Sommerzeit
  '2026-10-24', // Samstag vor dem Ende der Sommerzeit
  '2026-10-25', // Sonntag, Ende der Sommerzeit
  '2026-12-31', // Jahresende, letzter Tag im Regelwerk
  '2027-01-01', // ausserhalb des Regelwerks -- muss null ergeben
];
const ZEITEN = [];
for (let h = 0; h < 24; h++) {
  for (const m of [0, 15, 30, 45]) {
    ZEITEN.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  }
}
const DAUERN = [15, 60, 235, 330, 331, 420, 421, 540, 541, 600, 720, 1439];
const PAUSEN = [[0, 0], [15, 0], [30, 0], [30, 1], [60, 0], [90, 1], [2000, 0]];

const faelle = [];
for (const datum of DATEN) {
  for (const von of ZEITEN) {
    for (const dauer of DAUERN) {
      const startMin = Number(von.slice(0, 2)) * 60 + Number(von.slice(3, 5));
      const endMin = (startMin + dauer) % 1440;
      const bis = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
      const [pause, bezahlt] = PAUSEN[faelle.length % PAUSEN.length];
      faelle.push({ datum, von, bis, pause, bezahlt,
        sparte: faelle.length % 3 === 0 ? 'reinigung' : (faelle.length % 3 === 1 ? '' : 'sicherheit'),
        stdMin: dauer });
    }
  }
}
// Randfaelle, die die Schleife nicht erzeugt: fehlende Zeiten.
faelle.push({ datum: '2026-03-08', von: null, bis: '12:00', pause: 0, bezahlt: 0, sparte: null, stdMin: 0 });
faelle.push({ datum: '2026-03-08', von: '12:00', bis: null, pause: 0, bezahlt: 0, sparte: null, stdMin: 0 });
faelle.push({ datum: '2026-03-08', von: '12:00', bis: '12:00', pause: 0, bezahlt: 0, sparte: 'Reinigung', stdMin: 0 });

check(`Es werden ${faelle.length} Faelle gerechnet -- genug, um nicht nur die gedachten zu treffen`,
  faelle.length > 3000);

// ── Beide Fassungen rechnen ──────────────────────────────────────────────
const jsErgebnis = faelle.map(f => ({
  roh:   js.gavRohMin(f.von, f.bis),
  netto: js.gavNetto(f.von, f.bis, f.pause, f.bezahlt),
  bonus: js.gavBonusMin(f.datum, f.von, f.bis),
  pause: js.gavPauseSoll(f.von, f.bis),
  gilt:  js.gavGilt(f.sparte),
  std:   js.gavStd(f.stdMin),
}));

let phpErgebnis = null;
try {
  const roh = execFileSync('php', [`${WURZEL}/pruefungen/gavzeit_rechnen.php`],
    { input: JSON.stringify(faelle), maxBuffer: 64 * 1024 * 1024,
      // Dieselbe Zeitzone fuer beide Seiten. Der 12-Uhr-Anker macht den
      // Wochentag zwar unempfindlich, aber sich darauf zu verlassen waere
      // eine Annahme statt einer Bedingung.
      env: { ...process.env, TZ: 'Europe/Zurich' } });
  phpErgebnis = JSON.parse(roh.toString());
  check('Die PHP-Fassung laeuft und antwortet fuer jeden Fall',
    Array.isArray(phpErgebnis) && phpErgebnis.length === faelle.length);
} catch (e) {
  check('Die PHP-Fassung laeuft und antwortet fuer jeden Fall: ' + e.message, false);
}

// ── Vergleichen ──────────────────────────────────────────────────────────
// Zahlen mit einem Spielraum von einer Zehntelminute: Der Bonus ist ein
// Produkt aus Ganzzahl und 0.10, und Fliesskomma rundet in beiden Sprachen
// minimal anders. Alles darueber ist eine echte Abweichung.
const gleich = (a, b) => {
  if (typeof a === 'number' && typeof b === 'number') { return Math.abs(a - b) < 1e-9; }
  return JSON.stringify(a) === JSON.stringify(b);
};

if (phpErgebnis) {
  const abweichungen = [];
  for (let i = 0; i < faelle.length; i++) {
    for (const feld of ['roh', 'netto', 'bonus', 'pause', 'gilt', 'std']) {
      if (!gleich(jsErgebnis[i][feld], phpErgebnis[i][feld])) {
        abweichungen.push(`${feld}: ${JSON.stringify(faelle[i])} — `
          + `gav.js ${JSON.stringify(jsErgebnis[i][feld])} `
          + `gegen gavzeit.php ${JSON.stringify(phpErgebnis[i][feld])}`);
      }
    }
  }
  check('KRITISCH: gav.js und backend/gavzeit.php rechnen jeden Fall gleich', abweichungen.length === 0);
  if (abweichungen.length) {
    console.log(`\n  ${abweichungen.length} Abweichung(en), die ersten fuenf:`);
    abweichungen.slice(0, 5).forEach(a => console.log('   ' + a));
    console.log('');
  }

  // Die Pruefung waere wertlos, wenn beide Fassungen fuer alles null oder
  // dasselbe lieferten. Darum wird belegt, dass die Faelle ueberhaupt
  // etwas unterscheiden.
  const bonusWerte = new Set(phpErgebnis.map(r => r.bonus));
  check('Die Faelle erzeugen tatsaechlich verschiedene Bonuswerte -- der Vergleich prueft etwas',
    bonusWerte.size > 20);
  check('Darunter sind Faelle ohne Bonus und Faelle mit Bonus',
    phpErgebnis.some(r => r.bonus === 0) && phpErgebnis.some(r => r.bonus > 0));
  check('KRITISCH: ausserhalb des Regelwerk-Zeitraums liefern BEIDE Fassungen null, statt zu rechnen',
    phpErgebnis.some((r, i) => faelle[i].datum === '2027-01-01' && r.bonus === null)
    && jsErgebnis.some((r, i) => faelle[i].datum === '2027-01-01' && r.bonus === null));
  check('KRITISCH: eine Pause laenger als die Schicht ergibt in beiden Fassungen keine Zeit, keine negative',
    phpErgebnis.some((r, i) => faelle[i].pause === 2000 && r.netto === ''));
  check('KRITISCH: die Sparte Reinigung schaltet in beiden Fassungen ab, andere Werte nicht',
    phpErgebnis.some((r, i) => faelle[i].sparte === 'reinigung' && r.gilt === false)
    && phpErgebnis.some((r, i) => faelle[i].sparte === '' && r.gilt === true));
}

// ── Und der Grund, warum es die zweite Fassung gibt ──────────────────────
// Ohne diesen Nachweis koennte jemand die PHP-Fassung stillschweigend
// loeschen und den Lohnlauf wieder aus dem Browser fuettern.
const lauf = readFileSync(`${WURZEL}/backend/lohnlauf.php`, 'utf8');
check('KRITISCH: der Lohnlauf rechnet mit der SERVERSEITIGEN Fassung',
  /gavzeit\.php/.test(lauf) && /gavzeit_(netto_min|bonus_min)/.test(lauf));
check('KRITISCH: der Lohnlauf nimmt keine fertigen Stunden aus der Anfrage entgegen',
  !/\$input\s*\[\s*['"](stunden|netto_min|bonus)/.test(lauf));

// Dieselbe Haltung an einer zweiten Stelle: Welchen Lauf ein neuer ersetzt,
// ermittelt der Server aus dem Bestand -- nicht der Browser. Sonst stuende
// in der Verkettung, was jemand behauptet, statt was gilt.
const endpunkt = readFileSync(`${WURZEL}/backend/api/lohnlaeufe.php`, 'utf8');
check('KRITISCH: die Storno-Verkettung kommt aus der Datenbank, nicht aus der Anfrage',
  !/\$input\s*\[\s*['"]ersetzt_lauf_id/.test(endpunkt)
  && /status = 'storniert'/.test(endpunkt));

console.log(`${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) {
  console.log('  ✗ ' + bad.join('\n  ✗ '));
  process.exit(1);
}
console.log('Alle Pruefungen bestanden.');
