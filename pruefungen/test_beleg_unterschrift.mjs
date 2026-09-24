// Die Unterschrift am Link (ENT-688, Schritt 2).
//
// WARUM DIESE SUITE
//
// Die Annahme am Link hat einen neuen Ausweis bekommen: einen Code per
// Mail an die Adresse des Unterzeichnenden. Daran haengen Zusagen, die an
// verschiedenen Stellen stehen und jede fuer sich lautlos verschwinden
// koennen:
//
//   1. DER ALTE KLICK NIMMT NICHT MEHR AN. Sobald die Tabelle steht, weist
//      der Entscheidungsweg ein "annehmen" ab -- im Server.
//   2. ABLEHNEN BRAUCHT EINEN NAMEN.
//   3. EINE NEUE FASSUNG GEHT NUR MIT FREIGABE HINAUS -- im Server, und der
//      Versanddialog verlangt den Haken, bevor er sendet.
//   4. DER DIALOG IST BEDIENBAR: am Handy ohne seitliches Rollen, Knoepfe
//      mindestens 44 px, Felder mindestens 16 px (Hausregel), und er fuehrt
//      in zwei Schritten zum Code.
//   5. NACH DER ANNAHME steht das Pruefprotokoll im Dokument.
//
// Der Ablauf selbst (Code, Abdruck, Bremse, Ablauf, Fassungswechsel) laeuft
// in pruef_beleg_unterschrift.php wirklich.
import { WURZEL, HIER, browserPfad } from './pfade.mjs';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';
import http from 'http';
import { chromium } from 'playwright';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const lies = p => readFileSync(join(WURZEL, p), 'utf8');
const nurCode = q => q.replace(/\/\*[\s\S]*?\*\//g, '')
                      .replace(/<!--[\s\S]*?-->/g, '')
                      .replace(/^\s*\/\/.*$/gm, '')
                      .replace(/^\s*--.*$/gm, '');
const API = 'backend/api/';

// ── 0. Den Ablauf wirklich ausfuehren ────────────────────────────────
let phpAus = '', phpCode = 0;
try {
  phpAus = execFileSync('php', [`${HIER}/pruef_beleg_unterschrift.php`], { encoding: 'utf8' });
} catch (e) {
  phpAus = String(e.stdout || '') + String(e.stderr || '');
  phpCode = e.status || 1;
}
const phpAnzahl = Number((phpAus.match(/^(\d+) bestanden/m) || [0, 0])[1]);
check(`KRITISCH: pruef_beleg_unterschrift.php laeuft durch (${phpAnzahl} Pruefungen)`,
  phpCode === 0 && phpAnzahl > 0);
if (phpCode !== 0) { console.log(phpAus); }

for (const [name, praefix, tab] of [['Betreiber', 'betreiber_', 'be_belege'], ['Cockpit', '', 'belege']]) {
  // ── Der Endpunkt ─────────────────────────────────────────────────────
  const ep = nurCode(lies(API + praefix + 'beleg_unterschrift.php'));
  check(`KRITISCH: ${name} — der Unterschriftsweg nimmt nur POST`,
    /REQUEST_METHOD'\] !== 'POST'/.test(ep));
  check(`KRITISCH: ${name} — der Ausweis (versand_token) wird an der Tuer geprueft, vor dem Ablauf`,
    ep.indexOf('versand_token = ?') > 0 && ep.indexOf('versand_token = ?') < ep.indexOf('beleg_unterschrift_ablauf('));
  check(`${name} — der Endpunkt faehrt den gemeinsamen Ablauf, keine eigene Kopie`,
    /beleg_unterschrift_ablauf\(\$was, \$pdo, '(be_)?'/.test(ep) && !/beleg_unterschrift_pruefen\(/.test(ep));

  // ── 1./2. Der Entscheidungsweg ───────────────────────────────────────
  const ent = nurCode(lies(API + praefix + 'beleg_entscheidung.php'));
  check(`KRITISCH: ${name} — "annehmen" per Klick wird abgewiesen, sobald die Unterschrift steht`,
    /if \(\$mitUnterschrift && \$wahl === 'annehmen'\) \{\s*entscheidung_zurueck\(\$token\);/.test(ent));
  check(`KRITISCH: ${name} — Ablehnen ohne Namen wird abgewiesen`,
    /if \(\$mitUnterschrift && \$name === ''\) \{\s*entscheidung_zurueck\(\$token, 'name_fehlt'\);/.test(ent));
  check(`KRITISCH: ${name} — eine Entscheidung ueberschreibt keine andere (entscheidung_am IS NULL)`,
    new RegExp(`UPDATE ${tab} SET status = \\?[\\s\\S]{0,400}entscheidung_am IS NULL`).test(ent));

  // ── 3. Die Freigabe im Server ────────────────────────────────────────
  const vers = nurCode(lies(API + praefix + 'beleg_versenden.php'));
  const iPruef = vers.indexOf("freigabe_noetig");
  check(`KRITISCH: ${name} — eine neue Fassung ohne Freigabe wird abgewiesen, BEVOR gesendet wird`,
    iPruef > 0 && iPruef < vers.indexOf('smtp_senden(')
    && /\$naechste\['neu'\] && beleg_unterschreibbar\([\s\S]{0,60}\) && !\$freigabe/.test(vers));
  check(`${name} — die Freigabe landet an der Fassung`,
    /beleg_fassung_anlegen\([^;]*\$freigabe[,)]/.test(vers));
}

// Die beiden Oberflaechen verlangen den Haken, bevor sie senden.
for (const [name, datei, fn] of [['Betreiber', 'betreiber.html', 'frageStellen'], ['Cockpit', 'dashboard.html', 'askConfirm']]) {
  const q = lies(datei);
  check(`KRITISCH: ${name} — der Versanddialog sperrt "Versenden", bis der Haken gesetzt ist`,
    new RegExp(`function ${fn}\\([^)]*haken\\)[\\s\\S]{0,600}(ja|b)\\.disabled = !!haken;`).test(q));
  check(`${name} — der Versand schickt die Freigabe mit`, /freigabe: !!haken/.test(q));
}

// ── 5. Gerenderte Seiten ─────────────────────────────────────────────
const rendern = v => {
  try { return execFileSync('php', [`${HIER}/pruef_betreiber_beleg_rendern.php`, v], { encoding: 'utf8' }); }
  catch (e) { return 'FEHLER ' + String(e.stdout || '') + String(e.stderr || ''); }
};
const offen = rendern('signatur');
const an = rendern('angenommen');
const ab = rendern('abgelehnt');
check('KRITISCH: offen — Annehmen oeffnet den Dialog, es gibt keinen Annehmen-Knopf im Formular mehr',
  offen.includes('uzAnnehmen()') && !offen.includes('value="annehmen"'));
check('KRITISCH: angenommen — das Pruefprotokoll steht IM Dokument, mit der Pruefsumme',
  /<div id="dokumentGanz">[\s\S]*id="pruefprotokoll"/.test(an) && /[0-9a-f]{64}/.test(an));
check('KRITISCH: angenommen — die abweichende Codeadresse steht im Protokoll',
  an.includes('weicht von der Empfängeradresse des Belegs ab'));
check('angenommen — die Seitenspalte nennt, wer angenommen hat',
  an.includes('Angenommen am') && an.includes('von Erika Beispiel, Geschäftsführerin'));
check('angenommen — die Linie traegt den Namen, "Ort, Datum" die elektronische Annahme',
  an.includes('Elektronisch angenommen am') && />Erika Beispiel</.test(an));
check('KRITISCH: angenommen — kein Dialog und kein Knopf mehr', !an.includes('uzAnnehmen()'));
check('abgelehnt — die Seitenspalte nennt, wer abgelehnt hat',
  ab.includes('Abgelehnt am') && ab.includes('von Rolf Muster') && !ab.includes('id="pruefprotokoll"'));

// ── 4. Der Dialog im Browser, gemessen ───────────────────────────────
const server = http.createServer((req, res) => {
  const pfad = req.url.split('?')[0];
  if (pfad === '/unterschrift.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    res.end(readFileSync(join(WURZEL, 'unterschrift.js')));
    return;
  }
  if (pfad === '/api/seite.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(offen);
    return;
  }
  res.writeHead(404); res.end('');
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/api/seite.html`;
const browser = await chromium.launch({ executablePath: browserPfad() });

const MESSEN = () => {
  const sicht = el => !!el && el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden';
  const h = document.getElementById('uzHuelle');
  const karte = h ? h.querySelector('.uz-karte') : null;
  const felder = [...document.querySelectorAll('#uzSchritt1 input:not([type=checkbox]), #uzSchritt2 input')]
    .filter(sicht).map(e => parseFloat(getComputedStyle(e).fontSize));
  const knoepfe = [...document.querySelectorAll('#uzHuelle button')].filter(sicht)
    .map(b => b.getBoundingClientRect().height);
  return {
    offen: !!h && getComputedStyle(h).display !== 'none',
    schritt1: sicht(document.getElementById('uzSchritt1')),
    schritt2: sicht(document.getElementById('uzSchritt2')),
    codeText: (document.getElementById('uzCodeText') || {}).textContent || '',
    fehler1: (document.getElementById('uzFehler1') || {}).textContent || '',
    feldMin: felder.length ? Math.min(...felder) : 0,
    knopfMin: knoepfe.length ? Math.min(...knoepfe) : 0,
    breite: document.documentElement.scrollWidth,
    karteBreite: karte ? karte.getBoundingClientRect().width : 0,
    zeichnen: !!document.querySelector('#uzZeichnung button, #uzZeichnung .usig-cta'),
  };
};

for (const [name, breite, hoehe] of [['Desktop', 1280, 900], ['Handy', 390, 844]]) {
  const seite = await browser.newPage({ viewport: { width: breite, height: hoehe } });
  const fehler = [];
  seite.on('pageerror', e => fehler.push(e.message));
  const anfragen = [];
  await seite.route('**/betreiber_beleg_unterschrift.php', route => {
    const k = JSON.parse(route.request().postData() || '{}');
    anfragen.push(k);
    const antwort = k.was === 'anfordern'
      ? { status: 'ok', id: 7, an: k.email, gueltig_min: 15 }
      : { status: 'error', lage: 'falsch', message: 'Der Code stimmt nicht.' };
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(antwort) });
  });
  await seite.goto(url, { waitUntil: 'load' });
  await seite.waitForTimeout(150);
  const zu = await seite.evaluate(MESSEN);
  await seite.click('button:has-text("Annehmen")');
  await seite.waitForTimeout(150);
  const auf = await seite.evaluate(MESSEN);
  // Ohne Code (ENT-708): die Empfaengeradresse steht vorbelegt, der Knopf
  // nimmt direkt an; wer eine andere Adresse eintraegt, fordert den Code an.
  const vorbelegt = await seite.evaluate(() => ({ email: document.getElementById('uzEmail').value,
    knopf: document.getElementById('uzAnfordern').textContent }));

  // Ohne Haken: der Server wird trotzdem gefragt und sagt nein -- hier
  // steht das Nein des nachgebildeten Servers nicht zur Pruefung, sondern
  // dass die Angaben vollstaendig ankommen.
  await seite.fill('#uzName', 'Erika Beispiel');
  await seite.fill('#uzFunktion', 'Geschäftsführerin');
  await seite.fill('#uzEmail', 'leitung@muster.invalid');
  const knopfFremd = await seite.evaluate(() => document.getElementById('uzAnfordern').textContent);
  await seite.check('#uzBerechtigt');
  await seite.click('#uzAnfordern');
  await seite.waitForTimeout(200);
  const schritt2 = await seite.evaluate(MESSEN);
  await seite.fill('#uzCode', '123456');
  await seite.click('#uzBestaetigen');
  await seite.waitForTimeout(200);
  const nachFalsch = await seite.evaluate(() => document.getElementById('uzFehler2').textContent);
  await seite.close();

  check(`${name} — keine Skriptfehler (${fehler.join(' / ')})`, fehler.length === 0);
  check(`KRITISCH: ${name} — der Dialog ist zu, bis jemand annimmt`, !zu.offen);
  check(`KRITISCH: ${name} — Annehmen oeffnet Schritt 1`, auf.offen && auf.schritt1 && !auf.schritt2);
  check(`${name} — das Zeichenfeld (unterschrift.js) ist eingebunden`, auf.zeichnen);
  check(`KRITISCH: ${name} — Eingabefelder mindestens 16 px (${auf.feldMin})`, auf.feldMin >= 16);
  check(`KRITISCH: ${name} — Knoepfe mindestens 44 px hoch (${auf.knopfMin.toFixed(1)})`, auf.knopfMin >= 44);
  // Die Seite rollt weder vor noch mit dem Dialog seitlich. Bis zu diesem
  // Stand war die Positionstabelle am Handy breiter als der Bildschirm (414
  // auf 390 px); sie steht jetzt in einem eigenen Rahmen und passt.
  check(`KRITISCH: ${name} — nichts rollt seitlich (${zu.breite} / ${auf.breite} bei ${breite} px)`,
    zu.breite <= breite && auf.breite <= breite);
  check(`${name} — der Dialog passt in die Breite (${auf.karteBreite.toFixed(0)} px)`,
    auf.karteBreite > 0 && auf.karteBreite <= breite - 16);
  check(`KRITISCH: ${name} — die Empfaengeradresse ist vorbelegt, der Knopf heisst "Verbindlich annehmen"`,
    vorbelegt.email === 'einkauf@muster.invalid' && vorbelegt.knopf === 'Verbindlich annehmen');
  check(`KRITISCH: ${name} — mit einer anderen Adresse heisst er "Code anfordern"`, knopfFremd === 'Code anfordern');
  const anf = anfragen.find(a => a.was === 'anfordern') || {};
  check(`KRITISCH: ${name} — die Anforderung traegt Token, Angaben und die Erklaerung`,
    anf.token === 'tok456' && anf.name === 'Erika Beispiel' && anf.funktion === 'Geschäftsführerin'
    && anf.email === 'leitung@muster.invalid' && anf.zeichnungsberechtigt === 1
    && anf.firma === 'Muster Sicherheit AG');
  check(`KRITISCH: ${name} — danach Schritt 2 mit der Adresse, an die der Code ging`,
    schritt2.schritt2 && !schritt2.schritt1 && schritt2.codeText.includes('leitung@muster.invalid'));
  const best = anfragen.find(a => a.was === 'bestaetigen') || {};
  check(`${name} — das Bestaetigen schickt Zeile und Code`, best.id === 7 && best.code === '123456');
  check(`KRITISCH: ${name} — ein falscher Code steht als Fehler da, statt still zu scheitern`,
    nachFalsch.includes('stimmt nicht'));
}

// Ohne Code bis zum Ende: Antwortet der Server "angenommen", laedt die Seite
// neu (und zeigt den angenommenen Beleg) -- kein Schritt 2.
{
  const seite = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const anfragen = [];
  await seite.route('**/betreiber_beleg_unterschrift.php', route => {
    const k = JSON.parse(route.request().postData() || '{}');
    anfragen.push(k);
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', lage: 'angenommen', abschluss: { pdf: true } }) });
  });
  await seite.goto(url, { waitUntil: 'load' });
  let geladen = 0;
  seite.on('load', () => { geladen++; });
  await seite.click('button:has-text("Annehmen")');
  await seite.fill('#uzName', 'Erika Beispiel');
  await seite.fill('#uzFunktion', 'Geschäftsführerin');
  await seite.check('#uzBerechtigt');
  await seite.click('#uzAnfordern');
  await seite.waitForTimeout(500);
  check('KRITISCH: ueber die Empfaengeradresse: eine Anfrage mit dieser Adresse, dann laedt die Seite neu -- ohne Code-Schritt',
    anfragen.length === 1 && anfragen[0].was === 'anfordern' && anfragen[0].email === 'einkauf@muster.invalid'
    && geladen >= 1);
  await seite.close();
}

await browser.close();
server.close();

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
