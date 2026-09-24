// Unsere Unterschrift auf Offerte und Vertrag (ENT-704).
//
// WARUM DIESE SUITE
//
//   1. DER KERN (Fassung, Pruefsumme, Kundenseite, PDF) laeuft in
//      pruef_beleg_eigene_unterschrift.php; hier nur gestartet.
//   2. OHNE UNTERSCHRIFT KEINE FREIGABE -- im Server, VOR dem Mailversand,
//      und die Unterschrift kommt ins Abbild, BEVOR die Fassung entsteht.
//   3. NUR DIE EIGENE: Welches Konto, sagt die Sitzung, nie die Anfrage.
//      Das Bild verlaesst den Server nur fuer das eigene Konto.
//   4. NUR BETREIBER (Punkt 5): Das Cockpit bleibt beim Namen.
//   5. IM BROWSER GEMESSEN: die Karte in drei Lagen, das Zeichnen bis zum
//      Speichern, der kraeftigere Strich, der Versanddialog ohne Unterschrift.
import { WURZEL, HIER, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { readFileSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);
const lies = p => readFileSync(join(WURZEL, p), 'utf8');
const nurCode = q => q.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ── 1. Der Kern ──────────────────────────────────────────────────────
let aus = '', code = 0;
try { aus = execFileSync('php', [`${HIER}/pruef_beleg_eigene_unterschrift.php`], { encoding: 'utf8' }); }
catch (e) { aus = String(e.stdout || '') + String(e.stderr || ''); code = e.status || 1; }
const anzahl = Number((aus.match(/^(\d+) bestanden/m) || [0, 0])[1]);
check(`KRITISCH: pruef_beleg_eigene_unterschrift.php laeuft durch (${anzahl} Pruefungen)`, code === 0 && anzahl > 0);
if (code !== 0) { console.log(aus); }

// ── 2. Die Sperre im Versand ─────────────────────────────────────────
const versand = nurCode(lies('backend/api/betreiber_beleg_versenden.php'));
const iPruef = versand.indexOf("be_unterschrift_von($pdo, (int)$ich['id'])");
const iKopie = versand.indexOf('$abbild[BELEG_FREIGABE_UNTERSCHRIFT] =');
check('KRITISCH: der Versand prueft die Unterschrift dessen, der freigibt -- aus der Sitzung',
  iPruef > 0 && !/be_unterschrift_von\(\$pdo, \(int\)\$in\[/.test(versand));
check('KRITISCH: … VOR der Mail (sonst ginge ein Link zu einer Fassung hinaus, die es nicht gibt)',
  iPruef > 0 && iPruef < versand.indexOf('smtp_senden('));
check('KRITISCH: … und kopiert sie ins Abbild, BEVOR die Fassung entsteht',
  iKopie > iPruef && iKopie < versand.indexOf('beleg_fassung_anlegen('));
check('KRITISCH: ohne Unterschrift bricht der Versand ab, nicht erst die Oberflaeche',
  /\$meine === ''[^;]*\)\s*\{\s*json_response\(\['status' => 'error', 'unterschrift_fehlt' => true/.test(versand)
  && /\$meine === null\)\s*\{\s*json_response\(\['status' => 'error', 'unterschrift_fehlt' => true/.test(versand));
check('die Sperre gilt nur fuer eine NEUE Fassung einer Offerte oder eines Vertrags',
  /if \(\$naechste\['neu'\] && beleg_unterschreibbar\(\(string\)\$beleg\['art'\]\) && \$abbild !== null\) \{\s*\$meine = be_unterschrift_von/.test(versand));

// ── 3. Nur die eigene ────────────────────────────────────────────────
const speichern = nurCode(lies('backend/api/betreiber_unterschrift_speichern.php'));
check('KRITISCH: Speichern schreibt nur ins eigene Konto (Sitzung), keine id aus der Anfrage',
  /UPDATE betreiber SET unterschrift = \?, unterschrift_am = NOW\(\) WHERE id = \?'\)\s*->execute\(\[\$bild, \(int\)\$ich\['id'\]\]\)/.test(speichern)
  && !/\$in\['id'\]/.test(speichern));
check('KRITISCH: Speichern verlangt eine Betreiber-Anmeldung mit zweitem Faktor', /\$ich = require_betreiber_voll\(\);/.test(speichern));
check('KRITISCH: Speichern nimmt nur eine gepruefte PNG-Zeichnung', /beleg_zeichnung_pruefen\(/.test(speichern));
check('das Logbuch haelt das Neuzeichnen fest, ohne das Bild', /be_log\(\$pdo, \$ich, 'konto', \(int\)\$ich\['id'\], 'unterschrift', null, null, true\)/.test(speichern));
const liste = nurCode(lies('backend/api/betreiber_konto_list.php'));
check('KRITISCH: das Bild verlaesst den Server nur fuer das eigene Konto',
  /\$k\['unterschrift'\] = \(\$k\['ich'\] && /.test(liste));

// ── 4. Nur Betreiber ─────────────────────────────────────────────────
check('KRITISCH: das Cockpit kopiert keine Unterschrift in die Fassung (ENT-704, Punkt 5)',
  !/BELEG_FREIGABE_UNTERSCHRIFT/.test(lies('backend/api/beleg_versenden.php')));
const modul = lies('backend/betreiber.php');
check('die Spalten stehen in der Tabelle und im Nachtrag',
  /unterschrift MEDIUMTEXT NULL,/.test(modul) && /\['betreiber', 'unterschrift',\s+"ALTER TABLE betreiber ADD COLUMN unterschrift MEDIUMTEXT NULL"\]/.test(modul));
check('betreiber.html laedt das Zeichenfeld, der Deploy legt es ins Betreiber-Buendel',
  /<script src="unterschrift\.js" defer><\/script>/.test(lies('betreiber.html'))
  && /cp unterschrift\.js\s+dist-betreiber\/unterschrift\.js/.test(lies('.github/workflows/deploy-hostpoint.yml')));
const rend = execFileSync('php', [`${HIER}/pruef_betreiber_beleg_rendern.php`, 'signatur'], { encoding: 'utf8' });
check('der Unterschriftsdialog des Kunden zeichnet kraeftig', /Unterschrift\.einrichten\(\{ziel:"uzZeichnung",kraeftig:true,/.test(rend));

// ── 5. Im Browser ────────────────────────────────────────────────────
const browser = await chromium.launch({ executablePath: browserPfad() });
const seite = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const fehler = [];
seite.on('pageerror', e => fehler.push(e.message));
const rufe = [];
await seite.route('**/api/**', route => {
  const url = route.request().url();
  rufe.push({ url, body: route.request().postData() || '' });
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (url.includes('betreiber_konto_list.php')) {
    return send({ status: 'ok', konten: globalThis.__konten || [], aktive: 1, archivierte: 0 });
  }
  if (url.includes('betreiber_unterschrift_speichern.php')) { return send({ status: 'ok' }); }
  return send({ status: 'ok', eingerichtet: true, belege: [], kunden: [], produkte: [] });
});
await seite.goto(`file://${WURZEL}/betreiber.html`);
await seite.waitForFunction(() => !!window.Unterschrift);
await seite.evaluate(() => {
  document.getElementById('tor').classList.add('versteckt');
  document.getElementById('haus').classList.remove('versteckt');
});
// Eine Zeichnung als PNG, im Browser erzeugt.
const PNG = await seite.evaluate(() => {
  const c = document.createElement('canvas'); c.width = 300; c.height = 90;
  const x = c.getContext('2d'); x.lineWidth = 4; x.beginPath(); x.moveTo(5, 80); x.lineTo(295, 10); x.stroke();
  return c.toDataURL('image/png');
});

const KONTO = { id: 3, name: 'A. Muster', vorname: 'A.', nachname: 'Muster', email: 'a@beispiel.invalid',
  aktiv: true, eingeladen: false, archiviert: false, zwei_faktor: true, angelegt_am: '2031-01-01', letzte_anmeldung: null };
async function karte(k) {
  globalThis.__konten = [k];   // die Liste, die bereichZeigen() nachlaedt
  await seite.evaluate(k => {
    konten = [k]; bereichZeigen('konten'); kOeffnen(k.id); kdZeichnen();
  }, k);
  await seite.waitForTimeout(80);
  return seite.evaluate(() => {
    const c = document.getElementById('kdUsigKarte');
    const r = document.getElementById('kdUebersicht').getBoundingClientRect();
    return c ? { text: c.textContent.replace(/\s+/g, ' ').trim(), knopf: (document.getElementById('kdUsigKnopf') || {}).textContent || '',
      bild: !!document.getElementById('kdUsigBild'), breite: c.getBoundingClientRect().width / r.width } : null;
  });
}
const ohne   = await karte({ ...KONTO, ich: true, unterschrift_da: false, unterschrift: null });
const mit    = await karte({ ...KONTO, ich: true, unterschrift_da: true, unterschrift: PNG });
const fremdJ = await karte({ ...KONTO, id: 4, ich: false, unterschrift_da: true, unterschrift: null });
const fremdN = await karte({ ...KONTO, id: 4, ich: false, unterschrift_da: false, unterschrift: null });
const nicht  = await karte({ ...KONTO, ich: true, unterschrift_da: null, unterschrift: null });
check('KRITISCH: eigenes Konto ohne Unterschrift: sagt, dass ohne sie keine Freigabe geht, und bietet das Zeichnen an',
  ohne && /Ohne sie kannst du keine Offerte und keinen Vertrag freigeben/.test(ohne.text) && ohne.knopf === 'Unterschrift zeichnen' && !ohne.bild);
check('KRITISCH: eigenes Konto mit Unterschrift: zeigt sie und "Neu zeichnen"', mit && mit.bild && mit.knopf === 'Neu zeichnen');
check('KRITISCH: fremdes Konto: nur hinterlegt oder nicht, kein Bild, kein Knopf',
  fremdJ && /Hinterlegt\./.test(fremdJ.text) && !fremdJ.bild && fremdJ.knopf === ''
  && fremdN && /Nicht hinterlegt\./.test(fremdN.text) && fremdN.knopf === '');
check('KRITISCH: nicht eingerichtet sieht anders aus als nicht hinterlegt',
  nicht && /noch nicht eingerichtet/.test(nicht.text) && nicht.knopf === '' && nicht.text !== ohne.text);
check(`die Karte geht ueber die ganze Breite der Uebersicht (gemessen: ${mit && mit.breite.toFixed(2)})`, mit && mit.breite > 0.97);

// Zeichnen bis zum Speichern
await karte({ ...KONTO, ich: true, unterschrift_da: false, unterschrift: null });
globalThis.__konten = [{ ...KONTO, ich: true, unterschrift_da: true, unterschrift: PNG }];
await seite.click('#kdUsigKnopf');
await seite.waitForTimeout(150);
const offen = await seite.evaluate(() => document.getElementById('usigVoll').classList.contains('usig-auf'));
check('KRITISCH: "Unterschrift zeichnen" oeffnet das Zeichenfeld', offen);
// Eine hohe Unterschrift mit Schlaufen, wie die aus dem ersten echten PDF:
// Genau dort wurde der Strich im verkleinerten Bild zum Haarstrich.
async function strich(y0) {
  const g = await seite.evaluate(() => { const r = document.getElementById('usigCanvas').getBoundingClientRect();
    return { l: r.left, t: r.top, b: r.width, h: r.height }; });
  await seite.mouse.move(g.l + g.b * 0.40, g.t + g.h * y0);
  await seite.mouse.down();
  for (let i = 1; i <= 10; i++) { await seite.mouse.move(g.l + g.b * (0.40 + i * 0.012), g.t + g.h * (y0 + (i % 2 ? 0.25 : -0.25))); }
  await seite.mouse.up();
  await seite.waitForTimeout(60);
}
await strich(0.5);
await seite.click('#usigOk');
await seite.waitForTimeout(300);
const gesp = rufe.find(r => r.url.includes('betreiber_unterschrift_speichern.php'));
let gespBody = {};
try { gespBody = JSON.parse(gesp ? gesp.body : '{}'); } catch (e) { /* bleibt leer */ }
check('KRITISCH: nach "Bestaetigen" geht die Zeichnung als PNG an den Server, ohne Konto-id',
  !!gesp && /^data:image\/png;base64,/.test(gespBody.zeichnung || '') && !('id' in gespBody));
check('danach wird die Kontenliste neu geladen und die Karte zeigt das Bild',
  rufe.filter(r => r.url.includes('betreiber_konto_list.php')).length > 0
  && await seite.evaluate(() => !!document.getElementById('kdUsigBild')));

// Kraeftig: dieselbe kleine Unterschrift, einmal so, einmal so
async function deckung(kraeftig) {
  await seite.evaluate(k => {
    window.__bild = null;
    Unterschrift.zeichnen({ kraeftig: k, fertig: b => { window.__bild = b; } });
  }, kraeftig);
  await seite.waitForTimeout(100);
  await strich(0.5);
  await seite.click('#usigOk');
  await seite.waitForTimeout(150);
  return seite.evaluate(() => new Promise(res => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const x = c.getContext('2d'); x.drawImage(img, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height).data;
      let n = 0; for (let i = 3; i < d.length; i += 4) { if (d[i] > 128) { n++; } }
      res(n / (c.width * c.height));
    };
    img.src = window.__bild;
  }));
}
const duenn = await deckung(false);
const kraeftig = await deckung(true);
check(`KRITISCH: kraeftig deckt eine hohe Unterschrift deutlich staerker (${(duenn * 100).toFixed(1)} % → ${(kraeftig * 100).toFixed(1)} %)`,
  duenn > 0 && kraeftig > duenn * 1.5);

// Der Versanddialog
async function versandDialog(eigene) {
  rufe.length = 0;
  await seite.evaluate(e => {
    bereichZeigen('offerten'); ofArt = 'offerte'; ofFormId = 5; ofFormFassung = null;
    ofEigeneUnterschrift = e; ofVersenden(5);
  }, eigene);
  await seite.waitForTimeout(100);
  const d = await seite.evaluate(() => ({
    titel: document.getElementById('frageTitel').textContent,
    ja: document.getElementById('frageJa').textContent,
    haken: document.getElementById('frageHakenZeile').style.display !== 'none',
    offen: document.getElementById('dlgFrage').classList.contains('on'),
  }));
  await seite.evaluate(() => dlgZu('dlgFrage'));
  return d;
}
const gesperrt = await versandDialog(false);
check('KRITISCH: ohne eigene Unterschrift sagt der Dialog es und fuehrt zum eigenen Konto',
  gesperrt.offen && gesperrt.titel === 'Deine Unterschrift fehlt' && gesperrt.ja === 'Zu meinem Konto' && !gesperrt.haken);
check('KRITISCH: … und schickt nichts ab', !rufe.some(r => r.url.includes('betreiber_beleg_versenden.php')));
const frei = await versandDialog(true);
check('GEGENPROBE: mit Unterschrift der gewohnte Dialog mit Freigabe-Haken', frei.offen && frei.haken && frei.titel !== 'Deine Unterschrift fehlt');
const unbekannt = await versandDialog(null);
check('unbekannt (nicht eingerichtet): der gewohnte Dialog, der Server entscheidet', unbekannt.haken && unbekannt.titel !== 'Deine Unterschrift fehlt');
check(`keine Skriptfehler (${fehler.join(' / ')})`, fehler.length === 0);

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
