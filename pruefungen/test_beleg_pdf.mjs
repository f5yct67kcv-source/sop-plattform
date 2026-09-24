// Das unterschriebene PDF (ENT-688, Schritt 3).
//
// WARUM DIESE SUITE
//
// Das PDF ist das Dokument, das nach einer Annahme bleibt. Daran haengen
// Zusagen, die an verschiedenen Stellen stehen:
//
//   1. ES ENTSTEHT EINMAL UND WIRD GESPEICHERT -- ausgeliefert wird nur das
//      gespeicherte, nie ein neu erzeugtes. (Ausgefuehrt in
//      pruef_beleg_pdf.php.)
//   2. DIE BIBLIOTHEK IST UNVERAENDERT: fpdf.php traegt die Pruefsumme, die in
//      backend/fpdf/HERKUNFT.md steht. Eine Anpassung gehoert in
//      belegpdf.php, sonst laesst sich FPDF nicht mehr gegen das Original
//      pruefen.
//   3. JEDES BUENDEL, DAS BELEGE ANNIMMT, HAT DAS PDF: belegpdf.php, fpdf.php
//      und die Schriften kommen dorthin, wohin belege.php kommt.
//   4. NACH DER ANNAHME LAEDT "HERUNTERLADEN" DAS GESPEICHERTE PDF, und die
//      Oberflaechen verlinken es.
import { WURZEL, HIER } from './pfade.mjs';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const lies = p => readFileSync(join(WURZEL, p), 'utf8');
const nurCode = q => q.replace(/\/\*[\s\S]*?\*\//g, '')
                      .replace(/<!--[\s\S]*?-->/g, '')
                      .replace(/^\s*\/\/.*$/gm, '')
                      .replace(/^\s*#.*$/gm, '');

// ── 1. Den Ablauf wirklich ausfuehren ────────────────────────────────
let phpAus = '', phpCode = 0;
try {
  phpAus = execFileSync('php', [`${HIER}/pruef_beleg_pdf.php`], { encoding: 'utf8' });
} catch (e) {
  phpAus = String(e.stdout || '') + String(e.stderr || '');
  phpCode = e.status || 1;
}
const phpAnzahl = Number((phpAus.match(/^(\d+) bestanden/m) || [0, 0])[1]);
check(`KRITISCH: pruef_beleg_pdf.php laeuft durch (${phpAnzahl} Pruefungen)`, phpCode === 0 && phpAnzahl > 0);
if (phpCode !== 0) { console.log(phpAus); }

// ── 2. FPDF unveraendert ─────────────────────────────────────────────
const herkunft = lies('backend/fpdf/HERKUNFT.md');
const soll = (herkunft.match(/sha256\(fpdf\.php\) = ([0-9a-f]{64})/) || [])[1];
const ist = createHash('sha256').update(readFileSync(join(WURZEL, 'backend/fpdf/fpdf.php'))).digest('hex');
check('KRITISCH: fpdf.php ist unveraendert gegenueber der dokumentierten Herkunft', !!soll && soll === ist);
check('die Lizenz von FPDF liegt bei', lies('backend/fpdf/LIZENZ.txt').includes('Permission is hereby granted'));
const schriften = readdirSync(join(WURZEL, 'backend/fpdf/font'));
const genutzt = [...new Set([...lies('backend/belegpdf.php').matchAll(/SetFont\('([A-Za-z]+)',\s*'([BI]*)'/g)]
  .map(m => (m[1] + m[2]).toLowerCase()))];
check(`KRITISCH: jede verwendete Schrift liegt bei (${genutzt.join(', ')})`,
  genutzt.length > 0 && genutzt.every(s => schriften.includes(s + '.json')));

// ── 3. Der Deploy ────────────────────────────────────────────────────
// Nur die Kommentarzeilen weg -- der Filter fuer /* */ fraesse im YAML
// alles zwischen zwei Pfaden wie backend/api/*.php.
const deploy = lies('.github/workflows/deploy-hostpoint.yml').replace(/^\s*#.*$/gm, '');
const buendel = [...deploy.matchAll(/cp backend\/belege\.php\s+(dist[a-z0-9-]*)\//g)].map(m => m[1]);
check('drei Buendel bekommen belege.php', buendel.length >= 3);
for (const b of buendel) {
  check(`KRITISCH: ${b} bekommt beleg_pdf.php, FPDF und die Schriften`,
    new RegExp(`cp backend/belegpdf\\.php ${b}/belegpdf\\.php`).test(deploy)
    && new RegExp(`cp backend/fpdf/fpdf\\.php ${b}/fpdf/fpdf\\.php`).test(deploy)
    && new RegExp(`cp backend/fpdf/font/\\*\\.json ${b}/fpdf/font/`).test(deploy));
}

// ── 4. Endpunkte und Oberflaechen ────────────────────────────────────
for (const [name, datei, tab] of [['Betreiber', 'betreiber_beleg_pdf.php', 'be_belege'], ['Cockpit', 'beleg_pdf.php', 'belege']]) {
  const ep = nurCode(lies('backend/api/' + datei));
  check(`KRITISCH: ${name} — der Download liefert nur das GESPEICHERTE PDF`,
    /beleg_pdf_gespeichert\(/.test(ep) && !/beleg_pdf\(\$/.test(ep) && !/beleg_annahme_abschliessen\(/.test(ep));
  check(`KRITISCH: ${name} — der Ausweis ist der versand_token`,
    new RegExp(`FROM ${tab} WHERE versand_token = \\?`).test(ep));
  check(`${name} — als PDF ausgeliefert, nicht als Text`, /Content-Type: application\/pdf/.test(ep)
    && /X-Content-Type-Options: nosniff/.test(ep));
  const ablauf = nurCode(lies('backend/api/' + datei.replace('_pdf', '_unterschrift')));
  check(`KRITISCH: ${name} — der Unterschriftsweg laedt den PDF-Baustein`, /require_once __DIR__ \. '\/\.\.\/belegpdf\.php'/.test(ablauf));
}
const kern = nurCode(lies('backend/belege.php'));
check('KRITISCH: nach dem richtigen Code wird die Annahme abgeschlossen (PDF und Mails)',
  /beleg_annahme_abschliessen\(\$pdo, \$tabPraefix, \$id, \$b, \$firma/.test(kern)
  && kern.indexOf('beleg_annahme_abschliessen(') > kern.indexOf("SET status = 'bestaetigt'"));
check('KRITISCH: die GuardOpS-Signatur nur auf der Betreiberseite',
  /\(\$tabPraefix === 'be_' && function_exists\('mail_signatur_zeilen'\)\) \? mail_signatur_zeilen\(\) : \[\]/.test(kern));

// Die gerenderte Seite nach einer Annahme mit PDF.
const an = execFileSync('php', [`${HIER}/pruef_betreiber_beleg_rendern.php`, 'angenommen'], { encoding: 'utf8' });
check('KRITISCH: nach der Annahme laedt "Herunterladen" das gespeicherte PDF',
  /<a class="knopf knopf-plain" id="btnHerunterladen"[^>]*href="betreiber_beleg_pdf\.php\?token=tok456"/.test(an)
  && !/id="btnHerunterladen" onclick/.test(an));
const offen = execFileSync('php', [`${HIER}/pruef_betreiber_beleg_rendern.php`, 'signatur'], { encoding: 'utf8' });
check('GEGENPROBE: vor der Annahme bleibt "Herunterladen" die Kopie aus dem Browser',
  /id="btnHerunterladen" onclick="portalHerunterladen\(\)"/.test(offen));

// ENT-710: Die interne Fassung mit dem vollen Pruefprotokoll gibt es nur
// hinter der Anmeldung. Der Link des Kunden liefert die Kundenfassung.
for (const [name, datei, anmeldung] of [
  ['Betreiber', 'betreiber_beleg_pdf_intern.php', /\brequire_betreiber_voll\(\)/],
  ['Cockpit', 'beleg_pdf_intern.php', /\$user = require_session\(\);\s*require_recht\(\$user, 'offerten_lesen'\)/]]) {
  const ep = nurCode(lies('backend/api/' + datei));
  check(`KRITISCH: ${name} — das PDF mit Pruefprotokoll verlangt die Anmeldung`,
    anmeldung.test(ep) && ep.indexOf('beleg_pdf_intern(') > ep.search(anmeldung));
  check(`KRITISCH: ${name} — der Link des Kunden liefert nie die interne Fassung`,
    !/beleg_pdf_intern\(/.test(nurCode(lies('backend/api/' + datei.replace('_intern', '')))));
}
for (const [name, datei, ep] of [['Betreiber', 'betreiber.html', 'betreiber_beleg_pdf_intern.php'], ['Cockpit', 'dashboard.html', 'beleg_pdf_intern.php']]) {
  const q = lies(datei);
  check(`KRITISCH: ${name} — die Sperrleiste verlinkt das PDF mit Pruefprotokoll des eigenen Endpunkts`,
    new RegExp(`const OF_PDF_ENDPUNKT = '${ep.replace('.', '\\.')}';`).test(q)
    && /a\.href = API \+ OF_PDF_ENDPUNKT \+ '\?id=' \+ encodeURIComponent\(ofFormId\)/.test(q));
}

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
