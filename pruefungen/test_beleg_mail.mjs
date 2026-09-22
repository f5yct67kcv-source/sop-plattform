// Die Versandmail der Betreiberin traegt die gemeinsame Gestaltung
// (ENT-674).
//
// WARUM DIESE SUITE
//
// Die Mail zum Beleg baute ihr HTML bis ENT-674 selbst -- ein <div> mit
// vier Absaetzen, ohne Rahmen, ohne Fuss, ohne Logo, waehrend die Demo-Mail
// dieselbe Sache seit ENT-624 ueber mail_vorlage.php loest. Die Vorlage gab
// es also laengst; der Versand hat sie nur nie GEERBT. Genau die Sorte
// Regelbruch, die in CLAUDE.md steht ("gebrochen beim Bauen von etwas
// Neuem, das die Regel nicht geerbt hat") -- und sie faellt niemandem auf,
// weil beide Mails fuer sich genommen funktionieren.
//
// Was sich ausfuehren laesst, laeuft in pruef_beleg_mail.php wirklich:
// dort wird die Mail gebaut und am Ergebnis geprueft. Hier steht, was man
// nur am Quelltext sieht -- und die Annahme ueber den Deploy, ohne die die
// ganze Sache live auf einem fehlenden require_once stirbt.
import { WURZEL, HIER } from './pfade.mjs';
import { readFileSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const lies = p => readFileSync(join(WURZEL, p), 'utf8');
// Kommentare weg, bevor ueber CODE geurteilt wird -- sonst faende jede
// Suche auch die Stelle, an der eine Datei erklaert, was sie bewusst NICHT
// tut, und ausgerechnet die sorgfaeltig kommentierte fiele durch.
const nurCode = q => q.replace(/\/\*[\s\S]*?\*\//g, '')
                      .replace(/^\s*\/\/.*$/gm, '')
                      .replace(/^\s*#.*$/gm, '');

const versand = nurCode(lies('backend/api/betreiber_beleg_versenden.php'));
const kern    = nurCode(lies('backend/belege.php'));
const deploy  = lies('.github/workflows/deploy-hostpoint.yml');

// ── 1. Die Mail wirklich bauen ────────────────────────────────────────
let phpAus = '', phpCode = 0;
try {
  phpAus = execFileSync('php', [`${HIER}/pruef_beleg_mail.php`], { encoding: 'utf8' });
} catch (e) {
  phpAus = String(e.stdout || '') + String(e.stderr || '');
  phpCode = e.status || 1;
}
const phpAnzahl = Number((phpAus.match(/^(\d+) bestanden/m) || [0, 0])[1]);
// phpAnzahl > 0 gehoert MIT in die Bedingung: Stuerzt die PHP-Datei ab,
// bevor sie ihre Zusammenfassung druckt, ist phpCode 0 und die Suite waere
// ohne diese zweite Bedingung gruen, ohne dass etwas geprueft wurde.
check(`KRITISCH: pruef_beleg_mail.php laeuft durch (${phpAnzahl} Pruefungen)`,
  phpCode === 0 && phpAnzahl > 0);
if (phpCode !== 0) { console.log(phpAus); }

// ── 2. Der Endpunkt baut kein eigenes HTML mehr ───────────────────────
//
// DIE zentrale Pruefung dieser Datei, und sie ist bewusst am VERBOT
// aufgehaengt statt am Aufruf: Ein zusaetzliches, handgeschriebenes <p>
// neben dem Vorlagenaufruf waere wieder der Zustand, den ENT-674 beendet
// hat -- zwei Gestaltungen in einer Datei.
for (const spur of ['<div', '<p ', '<a href', 'style="']) {
  check(`KRITISCH: der Versand schreibt kein HTML mehr selbst (${spur})`,
    !versand.includes(spur));
}
check('KRITISCH: er laesst die Mail von der gemeinsamen Vorlage bauen',
  /beleg_mail\s*\(/.test(versand));

// ── 3. Was beim Versand mitgehen muss ─────────────────────────────────
//
// Die Bilder sind kein Beiwerk: Ohne sie zeigt das Mailprogramm unter der
// Signatur einen zerbrochenen Rahmen statt des Logos, weil das HTML auf
// cid: verweist. Geprueft an der Uebergabe, nicht am Wortlaut.
const sendeZeile = versand.slice(versand.indexOf('smtp_senden('),
                                 versand.indexOf('smtp_senden(') + 300);
check('KRITISCH: die eingebetteten Bilder gehen mit',
  /smtp_senden\(/.test(versand) && /\$mail\['bilder'\]/.test(sendeZeile));
check('KRITISCH: Betreff, HTML und Textfassung kommen aus derselben Hand',
  ["'betreff'", "'html'", "'text'"].every(t => sendeZeile.includes(t)));
// Die Textfassung ist kein Beiwerk: Ein Mailprogramm ohne HTML zeigt sie,
// und sie hat nie einen Knopf -- der Link muss darin stehen (geprueft in
// der PHP-Datei).
check('KRITISCH: die Signatur kommt aus dem Deploy, nicht aus dem Repository',
  /mail_signatur_zeilen\(\)/.test(versand));
check('KRITISCH: die Anrede holt die Kontaktperson aus der Datenbank',
  /kontaktperson/.test(versand));

// ── 4. Die Annahme ueber den Deploy ───────────────────────────────────
//
// belege.php bindet mail_vorlage.php per require_once ein. Ein Buendel, das
// nur die eine Datei kopiert, stirbt beim ersten Aufruf an einem fehlenden
// require_once -- sichtbar nur als "Unerwarteter Serverfehler", und LOKAL
// faellt es nie auf, weil dort beide Dateien nebeneinander liegen.
// Derselbe Fallstrick, der schon die Demo-Anforderung live zerlegt hat
// (Kommentar im Deploy zu dist-betreiber).
check('KRITISCH: belege.php bindet die Mailgestaltung selbst ein',
  /require_once __DIR__ \. '\/mail_vorlage\.php'/.test(kern));
const ziele = [...deploy.matchAll(/cp backend\/belege\.php\s+(\S+)/g)]
  .map(t => t[1].replace(/\/[^/]*$/, ''));
check('die Buendel, die belege.php bekommen, sind auffindbar', ziele.length > 0);
for (const ziel of ziele) {
  check(`KRITISCH: ${ziel} bekommt auch mail_vorlage.php`,
    new RegExp(`cp backend/mail_vorlage\\.php\\s+${ziel}/`).test(deploy));
  // Ohne die Bilddatei bleibt die Signatur textlich (mail_bild_lesen gibt
  // null zurueck) -- kein Absturz, aber eine Mail ohne Marke.
  check(`… und das Logo der Signatur (${ziel})`,
    new RegExp(`cp backend/guardops-signatur\\.png\\s+${ziel}/`).test(deploy));
}

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
