// Das Werkzeug, das die Staging-.htaccess baut (ENT-538,
// staging-htaccess-bauen.py).
//
// WORAUF DIESE SUITE ACHTET -- und warum es ueberhaupt eine gibt:
//
// Eine .htaccess sagt nicht, dass sie falsch ist. Sie wirkt nur anders.
// Faellt beim Ersetzen der Passwortschutz-Block oben weg, steht Staging
// offen im Netz, ohne dass irgendwo etwas rot wird; bleibt umgekehrt der
// alte Teil unten stehen, greifen die neuen Sperren nicht, und die Seite
// sieht genauso aus wie vorher. Beide Fehler sind unsichtbar -- darum
// werden sie hier gemacht und nachgesehen, ob das Werkzeug sie abfaengt.
//
// Das Werkzeug wird WIRKLICH AUSGEFUEHRT, an nachgebauten Dateien in einem
// Wegwerf-Verzeichnis. Nichts davon beruehrt eine echte .htaccess.
import { WURZEL } from './pfade.mjs';
import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const SKRIPT = join(WURZEL, 'staging-htaccess-bauen.py');
const AUSGABE = join(WURZEL, 'staging-htaccess-fertig.txt');
const MARKE = '#@__HCP_END__@#';

// Die Ausgabedatei entsteht im Wurzelverzeichnis. Was vorher dort lag,
// wird gemerkt und am Ende wiederhergestellt -- eine Pruefung, die dem
// Entwickler seine Arbeitsdatei wegnimmt, ist ein Aergernis.
const vorher = existsSync(AUSGABE) ? readFileSync(AUSGABE, 'utf8') : null;

function lauf(...args) {
  try {
    return { code: 0, aus: execFileSync('python3', [SKRIPT, ...args],
      { cwd: WURZEL, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { code: e.status || 1, aus: String(e.stdout || '') + String(e.stderr || '') };
  }
}

const tmp = mkdtempSync(join(tmpdir(), 'htac-'));

// ── Der gute Fall ────────────────────────────────────────────────────
const KOPF = [
  'AuthType Basic',
  'AuthName "Testbereich"',
  'AuthUserFile /beispiel/pfad/.htpasswd',
  'Require valid-user',
  MARKE,
].join('\n');
const ALT_UNTEN = '\n\n# veralteter Stand\n<FilesMatch "^(db)\\.php$">\n  Require all denied\n</FilesMatch>\n';

const vorlage = join(tmp, 'htaccess-probe');
writeFileSync(vorlage, KOPF + ALT_UNTEN, 'utf8');

const r = lauf(vorlage);
check('KRITISCH: das Werkzeug laeuft durch', r.code === 0);
const neu = existsSync(AUSGABE) ? readFileSync(AUSGABE, 'utf8') : '';
check('KRITISCH: es schreibt eine Ausgabedatei', neu.length > 0);

// Der Passwortschutz ist der Grund, warum die Datei ueberhaupt von Hand
// gepflegt wird (ENT-384). Faellt er weg, steht Staging offen.
check('KRITISCH: der Passwortschutz oben bleibt Zeichen fuer Zeichen erhalten',
  neu.startsWith(KOPF));
const markenzeilen = t => t.split('\n').filter(z => z.trim() === MARKE).length;
// Gezaehlt werden MARKENZEILEN, nicht Vorkommen: htaccess-staging-zusatz
// erwaehnt die Marke in einem Kommentar (Zeile 3). Wer blosse Vorkommen
// zaehlt, findet sie in jeder echten Staging-Datei zweimal -- einmal als
// Trennmarke, einmal als Text in dem Block, den das Werkzeug selbst
// geschrieben hat.
check('KRITISCH: die Marke steht genau einmal als eigene Zeile in der Ausgabe',
  markenzeilen(neu) === 1);

// Der alte Teil muss WEG sein -- bliebe er stehen, griffen die neuen
// Sperren nicht, und die Seite saehe genauso aus wie vorher.
check('KRITISCH: der alte Inhalt unterhalb der Marke ist ersetzt, nicht ergaenzt',
  !neu.includes('veralteter Stand'));

// Und der neue Teil muss dem entsprechen, was der Drift-Guard im
// Deploy erwartet: htaccess-hostpoint, dann htaccess-staging-zusatz
// (ENT-387, "im Anschluss"). Verglichen wird der INHALT, nicht die
// Reihenfolge im Quelltext des Werkzeugs.
const hostpoint = readFileSync(join(WURZEL, 'htaccess-hostpoint'), 'utf8').trim();
const zusatz    = readFileSync(join(WURZEL, 'htaccess-staging-zusatz'), 'utf8').trim();
const unten     = neu.slice(neu.indexOf(MARKE) + MARKE.length);
check('KRITISCH: der Inhalt von htaccess-hostpoint steht vollstaendig darunter',
  unten.includes(hostpoint));
check('KRITISCH: der Staging-Zusatz steht vollstaendig darunter',
  unten.includes(zusatz));
check('KRITISCH: der Zusatz steht NACH htaccess-hostpoint, nicht davor',
  unten.indexOf(zusatz) > unten.indexOf(hostpoint));

// Was das Werkzeug baut, muss zu dem passen, was der Drift-Guard im Deploy
// prueft -- sonst baut es gewissenhaft einen Stand, den der Deploy danach
// ablehnt.
const synced = readFileSync(join(WURZEL, 'staging-htaccess.synced-sha256'), 'utf8');
for (const datei of ['htaccess-hostpoint', 'htaccess-staging-zusatz']) {
  check(`Der Drift-Guard kennt ${datei}`, new RegExp(`^${datei}:[0-9a-f]{64}$`, 'm').test(synced));
}

// ── Die Faelle, in denen NICHT geraten werden darf ───────────────────
//
// Eine falsch geratene Grenze nimmt entweder den Passwortschutz weg oder
// laesst alte Regeln stehen. Beides faellt niemandem auf.
const ohneMarke = join(tmp, 'ohne-marke');
writeFileSync(ohneMarke, 'AuthType Basic\nRequire valid-user\n', 'utf8');
rmSync(AUSGABE, { force: true });
const r2 = lauf(ohneMarke);
check('KRITISCH: ohne Marke bricht es ab, statt die Grenze zu raten', r2.code !== 0);
check('KRITISCH: ohne Marke wird auch keine halbe Datei geschrieben', !existsSync(AUSGABE));
check('Die Meldung sagt, woran es liegen kann (Production-Datei erwischt)',
  /Production/.test(r2.aus));

// DER FALL, AN DEM DAS WERKZEUG SICH SELBST BLOCKIERT HAETTE: Eine echte
// Staging-.htaccess enthaelt unterhalb der Marke den Staging-Zusatz -- und
// der ERWAEHNT die Marke in einem Kommentar. Ein Werkzeug, das blosse
// Vorkommen zaehlt, faende ab dem zweiten Lauf zwei und braeche ab. Genau
// dann, wenn man es braucht: beim naechsten Nachtrag.
{
  const echt = join(tmp, 'echt-nachgebaut');
  writeFileSync(echt, KOPF + '\n\n' + hostpoint + '\n\n' + zusatz + '\n', 'utf8');
  rmSync(AUSGABE, { force: true });
  const rw = lauf(echt);
  check('KRITISCH: ein zweiter Lauf auf einer bereits gepflegten Datei geht durch',
    rw.code === 0 && existsSync(AUSGABE));
  const wieder = existsSync(AUSGABE) ? readFileSync(AUSGABE, 'utf8') : '';
  check('KRITISCH: auch dabei bleibt der Passwortschutz erhalten', wieder.startsWith(KOPF));
  check('KRITISCH: und der Inhalt waechst nicht mit jedem Lauf an',
    (wieder.match(/X-Robots-Tag/g) || []).length === 1);
}

const doppelt = join(tmp, 'doppelt');
writeFileSync(doppelt, `A\n${MARKE}\nB\n${MARKE}\nC\n`, 'utf8');
rmSync(AUSGABE, { force: true });
const r3 = lauf(doppelt);
check('KRITISCH: bei zweifacher Marke bricht es ab', r3.code !== 0);
check('Bei zweifacher Marke wird nichts geschrieben', !existsSync(AUSGABE));

const r4 = lauf(join(tmp, 'gibtsnicht'));
check('Eine fehlende Vorlage wird benannt, nicht stillschweigend uebergangen',
  r4.code !== 0 && /gibt es nicht/.test(r4.aus));

// Ohne Argument: nur der untere Teil. Das ist der Weg fuer den, der von
// Hand ersetzen will -- er muss denselben Inhalt bekommen.
rmSync(AUSGABE, { force: true });
const r5 = lauf();
const nurUnten = existsSync(AUSGABE) ? readFileSync(AUSGABE, 'utf8') : '';
check('Ohne Vorlage entsteht der Teil unterhalb der Marke', r5.code === 0 && nurUnten.length > 0);
check('KRITISCH: dieser Teil traegt keinen Passwortschutz-Block und keine Trennmarke',
  !nurUnten.includes('AuthUserFile') && markenzeilen(nurUnten) === 0);
check('KRITISCH: er ist inhaltsgleich mit dem, was sonst unter die Marke kommt',
  nurUnten.trim() === unten.trim());

// ── Die Ausgabe darf nie im Repository landen ────────────────────────
//
// Sie traegt den Passwortschutz-Block von Hostpoint -- fremde
// Konfiguration, moeglicherweise mit Pfaden, die niemanden etwas angehen.
const ignore = readFileSync(join(WURZEL, '.gitignore'), 'utf8');
check('KRITISCH: die Ausgabedatei steht in .gitignore',
  /^staging-htaccess-fertig\.txt$/m.test(ignore));

// Aufraeumen: der Zustand von vorher wird wiederhergestellt.
rmSync(AUSGABE, { force: true });
if (vorher !== null) { writeFileSync(AUSGABE, vorher, 'utf8'); }
rmSync(tmp, { recursive: true, force: true });

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
