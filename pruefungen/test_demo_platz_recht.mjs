// Der Demo-Zugang (die zehn Demo-Plaetze, ENT-600/601) braucht im Cockpit
// die RICHTIGE Datenschutzseite, nicht die der einen ENT-523-Demo-Umgebung.
//
// BEFUND DES PROJEKTINHABERS (2026-09-21): APP_ENV=demo allein sagt nur
// "irgendeine Demo" -- die eine ENT-523-Instanz (gemeinsamer Zugang,
// naechtliches Leeren) und die zehn Demo-Plaetze (eigene Datenbank je
// Platz, 14 Tage, persoenlicher Zugang) teilten sich denselben Wert und
// darum denselben Datenschutzlink im Dashboard, obwohl nur der eine Text
// auf den jeweiligen Fall zutrifft.
//
// GEPRUEFT WIRD DIE AUSSAGE, NICHT DER WORTLAUT (CLAUDE.md): Es reicht
// nicht, dass "IST_DEMO_PLATZ" irgendwo im Code steht -- gepruefte wird,
// dass der neue Platzhalter in GENAU den Buendeln, die testumgebung.js
// mitfuehren, gesetzt wird (nirgends sonst, sonst liefe ein anderes
// Buendel faelschlich als Demo-Platz), dass das Dashboard tatsaechlich
// danach verzweigt, und dass die neue Seite inhaltlich das GEGENTEIL der
// alten Aussagen traegt (14 Tage statt naechtlichem Leeren, keine
// gemeinsamen Zugangsdaten).
import { WURZEL } from './pfade.mjs';
import { readFileSync, existsSync } from 'fs';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const tu = readFileSync(`${WURZEL}/testumgebung.js`, 'utf8');
const wf = readFileSync(`${WURZEL}/.github/workflows/deploy-hostpoint.yml`, 'utf8');
const db = readFileSync(`${WURZEL}/dashboard.html`, 'utf8');
const backendDb = readFileSync(`${WURZEL}/backend/db.php`, 'utf8');

// ── 1. Der Platzhalter selbst ──────────────────────────────────────────
check('KRITISCH: testumgebung.js traegt den Platzhalter __IST_DEMO_PLATZ__',
  tu.includes("var IST_DEMO_PLATZ = '__IST_DEMO_PLATZ__';"));
check('KRITISCH: das Flag gilt nur INNERHALB von "demo" -- ein Demo-Platz '
    + 'ausserhalb der Demo waere ein Widerspruch in sich',
  /window\.APP_UMGEBUNG_DEMO_PLATZ\s*=\s*istDemo\s*&&\s*IST_DEMO_PLATZ\s*===\s*'1'/.test(tu));
check('KRITISCH: backend/db.php traegt denselben Platzhalter server-seitig '
    + '(ist_demo_platz(), fuer die Sperre in demo_nutzung_melden.php)',
  backendDb.includes("const IST_DEMO_PLATZ = '__IST_DEMO_PLATZ__';")
    && /function ist_demo_platz\(\): bool/.test(backendDb));

// ── 2. Der Deploy: GENAU die Buendel, die testumgebung.js ODER db.php ───
//     mitfuehren -- und fuer jede Datei einzeln, nicht nur irgendwo im Text.
const nullGesetzt = (ziel) => new RegExp(
  `__IST_DEMO_PLATZ__\\|0\\|g"\\s+${ziel.replace(/[/$.]/g, m => '\\' + m)}`).test(wf);
for (const ziel of ['dist/testumgebung.js', 'dist-cupi24/testumgebung.js']) {
  check(`KRITISCH: __IST_DEMO_PLATZ__ wird in ${ziel} ausdruecklich auf "0" gesetzt`,
    nullGesetzt(ziel));
}
// db.php steckt in FUENF Buendeln (wie SPARTE_REINIGUNG) -- guardops,
// betreiber und portal brauchen ist_demo_platz() serverseitig nie, aber
// db.php reist dort mit, und ein unersetzter Platzhalter darin waere
// eine Behauptung ohne Wert (dieselbe Regel wie bei SPARTE_REINIGUNG).
for (const ziel of ['dist/db.php', 'dist-guardops/db.php', 'dist-betreiber/db.php',
                    'dist-portal/db.php', 'dist-cupi24/db.php']) {
  check(`KRITISCH: __IST_DEMO_PLATZ__ wird in ${ziel} ausdruecklich auf "0" gesetzt`,
    nullGesetzt(ziel));
}
check('KRITISCH: jeder Demo-Platz bekommt den Schalter in testumgebung.js '
    + 'ausdruecklich auf "1" gesetzt',
  /ersetze __IST_DEMO_PLATZ__ "1" "dist-demo\/\$PLATZ\/testumgebung\.js"/.test(wf));
check('KRITISCH: jeder Demo-Platz bekommt den Schalter auch in db.php '
    + 'ausdruecklich auf "1" gesetzt',
  /ersetze __IST_DEMO_PLATZ__ "1" "dist-demo\/\$PLATZ\/db\.php"/.test(wf));

// Die gefaehrliche Richtung: NUR die Demo-Plaetze duerfen "1" bekommen --
// sonst haelt sich z.B. der Bestandsmandant faelschlich fuer einen
// Demo-Platz. Zwei Treffer sind richtig (db.php UND testumgebung.js je
// Platz), beide muessen auf dist-demo/$PLATZ/ zeigen.
const einsen = [...wf.matchAll(/__IST_DEMO_PLATZ__[^\n]*"1"[^\n]*/g)].map(m => m[0]);
check('KRITISCH: NUR die Demo-Plaetze bekommen die "1" -- genau zwei Stellen, '
    + 'beide fuer dist-demo/$PLATZ/',
  einsen.length === 2 && einsen.every(z => z.includes('dist-demo/$PLATZ/')));

// ── 3. Das Dashboard verzweigt tatsaechlich ──────────────────────────────
check('KRITISCH: dashboard.html liest APP_UMGEBUNG_DEMO_PLATZ, um den '
    + 'Datenschutzlink zu waehlen',
  /ds\.href\s*=\s*window\.APP_UMGEBUNG_DEMO_PLATZ/.test(db));
check('KRITISCH: ein Demo-Platz zeigt auf datenschutz-demo-platz.html',
  db.includes("'https://guardops.ch/datenschutz-demo-platz.html'"));
check('KRITISCH: die ENT-523-Demo-Umgebung zeigt weiterhin auf datenschutz-demo.html',
  db.includes("'https://guardops.ch/datenschutz-demo.html'"));

// Das Impressum braucht KEINE Verzweigung -- es beschreibt die Betreiberin
// (pzu consulting gmbh, ENT-568), nicht die jeweilige Instanz, und gilt
// darum unveraendert ueberall. Ausdruecklich geprueft statt stillschweigend
// als "passt schon" angenommen (Rueckfrage des Projektinhabers, 2026-09-21).
check('KRITISCH: das Anmelde-Tor traegt einen festen, unbedingten '
    + 'Impressum-Link (keine Verzweigung noetig oder vorhanden)',
  /<a href="https:\/\/guardops\.ch\/impressum\.html">Impressum<\/a>/.test(db)
    && !/APP_UMGEBUNG_DEMO_PLATZ[\s\S]{0,120}impressum/.test(db));
const impressum = readFileSync(`${WURZEL}/impressum.html`, 'utf8');
check('KRITISCH: das Impressum nennt die richtige Betreiberin (ENT-568)',
  impressum.includes('pzu consulting gmbh'));

// ── 4. Die neue Seite behauptet das GEGENTEIL der alten ─────────────────
const seite = `${WURZEL}/datenschutz-demo-platz.html`;
check('KRITISCH: datenschutz-demo-platz.html existiert', existsSync(seite));
if (existsSync(seite)) {
  const inhalt = readFileSync(seite, 'utf8');
  check('KRITISCH: nennt 14 Tage Laufzeit', /14\s*Tage/.test(inhalt));
  check('KRITISCH: nennt eine eigene Datenbank je Platz',
    /eigenen?\s+Datenbank/.test(inhalt));
  check('KRITISCH: behauptet NICHT das naechtliche Leeren der ENT-523-Umgebung '
      + '(02:00 UTC) fuer sich selbst',
    !inhalt.includes('02:00 UTC'));
  check('KRITISCH: die eigenen Zugangsdaten heissen ausdruecklich persoenlich, '
      + 'nicht gemeinsam',
    /persönliche[srn]?\s+Passwort/.test(inhalt));
  check('Verlinkt auf die Nutzungsbedingungen (ENT-624)',
    inhalt.includes('nutzungsbedingungen.html'));
  check('Verlinkt auf die eigene Erklaerung der ENT-523-Umgebung, statt sie zu verschweigen',
    inhalt.includes('datenschutz-demo.html'));

  // ── ENT-653: die Nutzungsauswertung ist jetzt gebaut -- der Text darf
  // das nicht mehr als Vorhaben behaupten, und er darf nicht mehr
  // versprechen, als tatsaechlich erfasst wird (nur Reiter/Dauer, keine
  // Klicks -- Entscheidung des Projektinhabers gegen die Klick-Variante).
  check('KRITISCH: behauptet NICHT mehr "geplant, heute nicht in Betrieb"',
    !/geplant,?\s*heute nicht in Betrieb/i.test(inhalt));
  check('KRITISCH: verspricht KEINE Klick-Erfassung (nur Reiter/Dauer wurde entschieden)',
    !/wo geklickt wird/i.test(inhalt));
  check('Nennt ausdruecklich, dass NICHT auf einzelne Klicks/Eingaben gemessen wird',
    /nicht erfasst[\s\S]{0,80}klick/i.test(inhalt) || /keine einzelnen Klicks/i.test(inhalt));
}

// ── ENT-653: nutzungsbedingungen.html verweist jetzt auf die richtige
// Datenschutzseite fuer den Demo-Zugang, nicht nur auf die allgemeine.
const nutzungsbedingungen = readFileSync(`${WURZEL}/nutzungsbedingungen.html`, 'utf8');
check('KRITISCH: nutzungsbedingungen.html verlinkt datenschutz-demo-platz.html',
  nutzungsbedingungen.includes('datenschutz-demo-platz.html'));

// Gegenprobe (Anleitung, nicht automatisiert): Wer testen will, ob diese
// Pruefung wirklich etwas bewacht, haengt in dashboard.html testweise wieder
// fest "datenschutz-demo.html" ein (ohne die Verzweigung) und sieht die
// Pruefung unter Punkt 3 rot werden.

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
