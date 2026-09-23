// Der Abholweg des Betreibers (Befund des Projektinhabers, 2026-09-23).
//
// WORUM ES GEHT
//
// Auf einem Demo-Platz stellte der Interessent eine Supportanfrage. Im
// Cockpit stand sie als "eingegangen", beim Betreiber kam sie nie an. Der
// Grund ist keine Zeile Logik, sondern eine Eigenschaft des Deploys: Im
// Buendel eines Demo-Platzes bleiben die vier Platzhalter der
// Betreiber-Datenbank unersetzt, betreiber_db() faellt darum auf db()
// zurueck -- der Platz ist sich selbst "Stamm". Dasselbe gilt fuer die
// Support-Freigabe: Sie liegt beim Betrieb, und der Betreiber sah nirgends,
// dass eine vorliegt.
//
// Beides loest derselbe Weg: Der Betreiber HOLT AB, statt dass der Mandant
// schickt. Diese Suite wacht ueber die vier Aussagen, an denen das haengt.
import { WURZEL, HIER } from './pfade.mjs';
import { readFileSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);
const lies = p => readFileSync(join(WURZEL, p), 'utf8');
// Kommentare weg, bevor ueber CODE geurteilt wird -- sonst faende jede
// Suche auch die Stelle, an der eine Datei erklaert, was sie NICHT tut.
const nurCode = q => q.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ── 1. Der Rechenkern, wirklich ausgefuehrt ──────────────────────────
let phpAus = '', phpCode = 0;
try {
  phpAus = execFileSync('php', [`${HIER}/pruef_support_sammeln.php`], { encoding: 'utf8' });
} catch (e) {
  phpAus = String(e.stdout || '') + String(e.stderr || '');
  phpCode = e.status || 1;
}
const phpAnzahl = Number((phpAus.match(/^(\d+) bestanden/m) || [0, 0])[1]);
check('KRITISCH: die Faelle von be_holt_ab() bestehen',
  phpCode === 0 && phpAnzahl > 0 && !phpAus.includes('\nx '));
phpAus.split('\n').filter(z => z.startsWith('x ')).forEach(z => bad.push('PHP: ' + z.slice(2)));

// ── 2. Geschrieben wird dort, wo der Vorgang liegt ───────────────────
//
// DIE GEFAEHRLICHSTE STELLE des Abholwegs: Ein ferner Vorgang wird
// abgeholt, die Antwort darauf aber in den Stamm geschrieben. Dann sieht
// der Betreiber seine Antwort, der Betrieb nie -- und niemandem faellt es
// auf, weil nichts scheitert.
const vorgang = nurCode(lies('backend/api/betreiber_support_vorgang.php'));
check('KRITISCH: die Antwort geht an die Anlage des Vorgangs, nicht an den Stamm',
  /sv_antwort\(\$ziel,/.test(vorgang) && !/sv_antwort\(\$pdo,/.test(vorgang));
check('KRITISCH: der Statuswechsel ebenso',
  /sv_status_setzen\(\$ziel,/.test(vorgang) && !/sv_status_setzen\(\$pdo,/.test(vorgang));
check('KRITISCH: gelesen wird aus derselben Quelle, in die geschrieben wird',
  /sv_detail\(\$quelle,/.test(vorgang) && /sv_nachrichten\(\$ziel,/.test(vorgang));
// Eine Stelle, nicht drei: Lesen, Antworten und Status treffen dieselbe
// Entscheidung. Drei Fassungen davon liefen irgendwann auseinander.
check('die Anlage wird an EINER Stelle bestimmt',
  (vorgang.match(/function vorgang_verbindung/g) || []).length === 1
  && (vorgang.match(/vorgang_verbindung\(/g) || []).length >= 3);
// Kein stiller Rueckfall auf den Stamm: Ein Mandant, der seinen Kanal
// nicht selbst fuehrt, traefe sonst einen gleichnummerierten fremden
// Vorgang.
check('KRITISCH: ohne Abholfall wird abgewiesen statt auf den Stamm zurueckgefallen',
  /be_holt_ab\([\s\S]{0,200}409/.test(vorgang));

// ── 3. Der Freigabe-Stand oeffnet nichts ─────────────────────────────
//
// Der Endpunkt liest ab, ob eine Freigabe vorliegt. Er ist KEIN Zugriff --
// und darf darum auch keiner werden: kein Schreiben, keine Betriebsdaten.
const lage = nurCode(lies('backend/api/betreiber_support_lage.php'));
check('KRITISCH: der Freigabe-Stand verlangt eine Betreiber-Sitzung',
  /require_betreiber_voll\(\)/.test(lage));
check('KRITISCH: er schreibt nichts',
  !/\b(INSERT|UPDATE|DELETE|ALTER|DROP)\b/i.test(lage));
// Er liest ausschliesslich ueber die Freigabe-Funktionen des Hauses und
// baut keine eigene Abfrage in die Anlage des Mandanten.
check('KRITISCH: er liest keine Betriebsdaten',
  !/SELECT[\s\S]{0,80}FROM\s+`?(mitarbeiter|einsaetze|rapporte|kunden|objekte|lohn)/i.test(lage));

// ── 4. Sechs Aussagen, sechs Texte (Hausregel) ───────────────────────
//
// Die Falle liegt beim sechsten: Eine Anlage, die nicht antwortet, hat
// nicht "keine Freigabe erteilt" -- wir wissen es bloss nicht. Wer das als
// "nie freigegeben" ausgibt, behauptet etwas ueber einen fremden Betrieb.
const kern = nurCode(lies('backend/support_sammeln.php'));
check('KRITISCH: eine nicht erreichbare Anlage meldet nicht feststellbar',
  /'lage'\s*=>\s*'nicht_feststellbar'/.test(kern));
const seite = lies('betreiber.html');
const texte = (seite.match(/const FREIGABE_TEXT = \{[\s\S]*?\};/) || [''])[0];
['offen', 'nie_freigegeben', 'abgelaufen', 'widerrufen', 'nicht_eingerichtet',
 'nicht_feststellbar'].forEach(l => {
  check(`die Oberflaeche hat einen eigenen Text fuer "${l}"`, texte.includes(l + ':'));
});
check('KRITISCH: "nicht feststellbar" liest sich nicht wie "keine Freigabe"',
  /nicht_feststellbar:\s*\[[^\]]*'[^']*feststellbar/.test(texte));
// Und eine Anlage, die beim Vorrat stumm blieb, wird benannt -- sonst
// saehe sie aus wie eine ohne Anfragen.
check('KRITISCH: stumme Anlagen werden im Vorrat benannt',
  /SV_ANLAGE_TEXT/.test(seite) && /nicht_erreichbar:/.test(seite)
  && /kein_kanal:/.test(seite));

// ── 5. Die Oberflaeche spricht den Vorgang mit seiner Anlage an ──────
//
// Die Ids zweier Datenbanken sind unabhaengig: Die 7 des einen Platzes ist
// nicht die 7 des anderen. Wer nur die Id schickt, oeffnet irgendeinen.
check('KRITISCH: die Anlage haengt am Oeffnen-Knopf',
  /data-sv-mandant=/.test(seite));
check('KRITISCH: Antwort und Statuswechsel schicken die Anlage mit',
  (seite.match(/mandant: svAktuellMandant/g) || []).length >= 2);

// ── 6. Ohne Deploy nuetzt nichts davon ───────────────────────────────
//
// Ein Rechenkern, den kein Buendel mitnimmt, ist auf dem Server nicht da --
// und der Endpunkt, der ihn einbindet, stirbt beim ersten Aufruf. Genau so
// ist hier schon einmal ein Endpunkt in keinem Buendel gelandet.
const deploy = lies('.github/workflows/deploy-hostpoint.yml');
check('KRITISCH: der Abholweg liegt im Betreiber-Buendel',
  /cp backend\/support_sammeln\.php dist-betreiber\//.test(deploy));
check('KRITISCH: und im Buendel der Anlage',
  /cp backend\/support_sammeln\.php dist\//.test(deploy));
// Er wird nur eingebunden, nie aufgerufen -- also gesperrt wie die
// uebrigen Rechenkerne.
['htaccess-betreiber', 'htaccess-cupi24', 'htaccess-hostpoint'].forEach(f => {
  check(`${f} sperrt den Abholweg`, lies(f).includes('support_sammeln'));
});

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
