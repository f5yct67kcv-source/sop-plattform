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

// ── 7. Die Bitte um eine Freigabe (ENT-683) ─────────────────────────
//
// Sie ist der einzige Weg, den der Betreiber selbst in der Hand hat -- und
// genau darum die Stelle, an der aus "fragen duerfen" versehentlich
// "hereinkommen duerfen" werden koennte.
let bitteAus = '', bitteCode = 0;
try {
  bitteAus = execFileSync('php', [`${HIER}/pruef_support_bitte.php`], { encoding: 'utf8' });
} catch (e) {
  bitteAus = String(e.stdout || '') + String(e.stderr || '');
  bitteCode = e.status || 1;
}
const bitteAnzahl = Number((bitteAus.match(/^(\d+) bestanden/m) || [0, 0])[1]);
check('KRITISCH: die Faelle der Bitte bestehen (ausgefuehrt, nicht gelesen)',
  bitteCode === 0 && bitteAnzahl > 0 && !bitteAus.includes('\nx '));
bitteAus.split('\n').filter(z => z.startsWith('x ')).forEach(z => bad.push('PHP: ' + z.slice(2)));

const bittePhp = nurCode(lies('backend/api/betreiber_support_bitte.php'));
// Der Betreiber schreibt eine BITTE in die Anlage des Betriebs. Er darf
// dort nichts anderes anfassen -- vor allem keine Freigabe ausstellen.
check('KRITISCH: die Bitte stellt keine Freigabe aus',
  !/support_freigeben\s*\(/.test(bittePhp));
check('KRITISCH: sie schreibt nur ueber die Bitte-Funktionen',
  !/\b(INSERT|UPDATE|DELETE)\b/i.test(bittePhp));
// Wer bittet, kommt aus der Sitzung -- nie aus der Anfrage. Derselbe
// Grundsatz wie beim Freigebenden (ENT-526).
check('KRITISCH: der Bittende kommt aus der Sitzung',
  /\$ich\['name'\]/.test(bittePhp)
  && !/\$daten\['gebeten_von'\]|\$daten\['wer'\]/.test(bittePhp));
check('KRITISCH: ohne Zweck keine Bitte', /\$zweck === ''[\s\S]{0,200}400/.test(bittePhp));
check('sie verlangt eine Betreiber-Sitzung', /require_betreiber_voll\(\)/.test(bittePhp));

// Und im Cockpit: Die Bitte steht in der bestehenden Karte, nicht in einem
// eigenen Container (Festlegung des Projektinhabers, 2026-09-23), und der
// Zweck wandert ins Formular, damit nur noch Dauer und Klick fehlen.
const cockpit = lies('dashboard.html');
check('KRITISCH: das Cockpit zeigt die Bitte in der Karte Support-Freigabe',
  /bitteBlock/.test(cockpit) && /Der Betreiber bittet um Einblick/.test(cockpit));
check('der Zweck der Bitte steht im Freigabe-Formular',
  /value="'\s*\+\s*\(bitte \? esc\(bitte\.zweck\)/.test(cockpit));
// Am Handy dieselbe Datei -- sonst laufen die beiden auseinander.
check('das Handy-Buendel traegt denselben Stand',
  lies('mobile/www/dashboard.html').includes('Der Betreiber bittet um Einblick'));

// ── 8. Der Betrieb erfaehrt von der Antwort (ENT-685) ───────────────
//
// ANLASS: Der Betreiber antwortete, und im Cockpit stand davon nichts --
// ausser einem Wort in einer Liste, die man erst aufsuchen muss.
let rmAus = '', rmCode = 0;
try {
  rmAus = execFileSync('php', [`${HIER}/pruef_support_rueckmeldung.php`], { encoding: 'utf8' });
} catch (e) {
  rmAus = String(e.stdout || '') + String(e.stderr || '');
  rmCode = e.status || 1;
}
const rmAnzahl = Number((rmAus.match(/^(\d+) bestanden/m) || [0, 0])[1]);
check('KRITISCH: die Faelle der Rueckmeldung bestehen (ausgefuehrt)',
  rmCode === 0 && rmAnzahl > 0 && !rmAus.includes('\nx '));
rmAus.split('\n').filter(z => z.startsWith('x ')).forEach(z => bad.push('PHP: ' + z.slice(2)));

// Die Glocke zieht ihre Zeilen aus derselben Stelle wie der Feed -- eine
// zweite Abfrage koennte eine andere Zahl zeigen als die Zeilen daneben.
const stats = nurCode(lies('backend/api/dashboard_stats.php'));
check('KRITISCH: der Supportkanal haengt am Feed, nicht an einer zweiten Abfrage',
  /ereignisse_sammeln\(db\(\), *12, *\$svStamm/.test(stats));
// Ohne Zuordnung wird NICHT geraten: ein fremder Vorgang in dieser Glocke
// waere schlimmer als eine Glocke ohne Support.
check('KRITISCH: ohne Mandantenzuordnung bleibt der Supportkanal aussen vor',
  /\$svMandant === null[\s\S]{0,80}\$svStamm = null/.test(stats));
// Und der Feed darf nicht daran haengen, dass die Betreiber-Ebene
// erreichbar ist -- er ist der Herzschlag der Uebersicht.
check('KRITISCH: eine nicht erreichbare Betreiber-Ebene reisst den Feed nicht mit',
  /catch \(Throwable \$e\)[\s\S]{0,120}\$svStamm = null/.test(stats));

const feed = nurCode(lies('backend/ereignisse.php'));
check('die Supportantwort ist nicht ueber den Feed abhakbar',
  !/'support_antwort'\s*=>/.test((feed.match(/const EREIGNIS_ARTEN = \{[\s\S]*?\};/) || [''])[0]));

const cockpit2 = lies('dashboard.html');
check('KRITISCH: die Glocke kennt die Supportantwort',
  /support_antwort:/.test(cockpit2) && /Support hat geantwortet|hat auf/.test(cockpit2));
check('KRITISCH: der Klick fuehrt in den Vorgang, nicht in die Uebersicht',
  /support_antwort'[\s\S]{0,300}saOeffnen\(e\.id\)/.test(cockpit2));
check('das Abzeichen am Support-Eintrag wird gesetzt',
  /supportAbzeichenSetzen/.test(cockpit2) && /nav-support-abz/.test(cockpit2));
// Angesagt statt nur eingefaerbt -- wer die Seite hoert, erfaehrt aus einer
// roten Scheibe nichts.
check('das Abzeichen wird auch angesagt',
  /aria-label[\s\S]{0,120}neue Antwort/.test(cockpit2));
check('das Handy-Buendel traegt denselben Stand',
  lies('mobile/www/dashboard.html').includes('supportAbzeichenSetzen'));

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
