// Oeffentliche Kundenseite (beleg_oeffentlich.php) wirklich ausfuehren
// (ENT-206), nicht nur die Serverantwort vortaeuschen wie in test_offerten.mjs
// und test_rechnungen.mjs. Vier Dinge haelt diese Suite scharf:
//
// 1. DIE SEITE LAEUFT UEBERHAUPT DURCH -- kein PHP-Fehler statt der Rechnung.
// 2. ZWEI-SPALTEN-AUFBAU: kompakte Zusammenfassung links, das eigentliche
//    Dokument (alles rechtsverbindliche: Datum, Adresse, Positionen, Summen)
//    vollstaendig rechts -- links stehen dieselben Kernangaben nur ZUSAETZLICH.
// 3. DRUCKEN UND HERUNTERLADEN FUNKTIONIEREN WIRKLICH: Drucken ruft
//    window.print() auf, Herunterladen laedt html2pdf.js nach und erzeugt
//    tatsaechlich eine PDF-Datei -- kein Knopf, der nur so aussieht.
// 4. DER QR-ZAHLTEIL ERSCHEINT NUR MIT GUELTIGER QR-IBAN (ENT-205) -- eine
//    Rechnung ohne QR-IBAN zeigt keinen kaputten/nicht scannbaren Code.
// 5. DIE UNTERSCHRIFTSSEITE (of_unterschriftsseite, ENT-187) WIRKT AUCH HIER
//    (ENT-207) -- vorher nur im internen Ausdruck beruecksichtigt, auf der
//    Seite, die der Kunde tatsaechlich druckt/herunterlaedt, ohne Wirkung.
import { WURZEL, HIER, browserPfad } from './pfade.mjs';
import { execFileSync } from 'child_process';
import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'fs';
import http from 'http';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

// ── Vier Varianten wirklich durch PHP rendern ─────────────────────────────
const VARIANTEN = ['rechnung_offen', 'rechnung_qr', 'offerte_offen', 'offerte_entschieden', 'offerte_unterschrift'];
const html = {};
for (const v of VARIANTEN) {
  let aus = '', code = 0;
  try {
    aus = execFileSync('php', [`${HIER}/pruef_beleg_oeffentlich_rendern.php`, v], { encoding: 'utf8' });
  } catch (e) {
    aus = String(e.stdout || '') + String(e.stderr || '');
    code = e.status || 1;
  }
  check(`KRITISCH: "${v}" rendert ohne PHP-Fehler`, code === 0 && aus.includes('</html>'));
  html[v] = aus;
}

// ── Lokaler Server: die echten qrcode.js/html2pdf.bundle.min.js einbinden,
// genau wie im Deploy per absoluten Pfad geladen ─────────────────────────
const server = http.createServer((req, res) => {
  const pfad = req.url.split('?')[0];
  let datei = null, typ = 'text/html; charset=utf-8';
  if (pfad === '/qrcode.js') { datei = `${WURZEL}/qrcode.js`; typ = 'application/javascript'; }
  else if (pfad === '/html2pdf.bundle.min.js') { datei = `${WURZEL}/html2pdf.bundle.min.js`; typ = 'application/javascript'; }
  else if (html[pfad.replace(/^\//, '').replace(/\.html$/, '')]) {
    datei = null;
    res.writeHead(200, { 'Content-Type': typ });
    res.end(html[pfad.replace(/^\//, '').replace(/\.html$/, '')]);
    return;
  }
  if (!datei || !existsSync(datei)) { res.writeHead(404); res.end('nicht gefunden'); return; }
  res.writeHead(200, { 'Content-Type': typ });
  res.end(readFileSync(datei));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const url = v => `http://127.0.0.1:${port}/${v}.html`;

const browser = await chromium.launch({ executablePath: browserPfad() });

try {
  // ── rechnung_offen: kein QR-Zahlteil, aber Drucken/Herunterladen da ─────
  {
    const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
    const fehler = [];
    page.on('pageerror', e => fehler.push(e.message));
    await page.goto(url('rechnung_offen'), { waitUntil: 'load' });
    check('KRITISCH: keine JS-Fehler beim Laden', fehler.length === 0);
    check('KRITISCH: die Zusammenfassung links steht', await page.isVisible('.zusammenfassung'));
    check('KRITISCH: das Dokument rechts steht', await page.isVisible('#dokumentSeite'));
    check('Die Zusammenfassung steht wirklich LINKS vom Dokument',
      (await page.locator('.zusammenfassung').boundingBox()).x
      < (await page.locator('.karte').boundingBox()).x);
    check('KRITISCH: kein QR-Zahlteil ohne hinterlegte QR-IBAN',
      !(await page.isVisible('text=Zahlung per QR-Rechnung')));
    check('Offener Betrag steht in der Zusammenfassung', /1.945\.80 CHF/.test(await page.textContent('.zusammenfassung')));

    // ── Ganze Seite, kein Ausschnitt (Projektinhaber-Vorgabe, ENT-206) ────
    // Dieser Beleg hat nur EINE kurze Position -- gerade DANN darf das
    // Dokument nicht auf den Inhalt zusammenschrumpfen, sondern muss wie
    // eine ganze, gedruckte Seite aussehen (gemessen, nicht angenommen).
    const dokHoehe = (await page.locator('#dokumentSeite').boundingBox()).height;
    check('KRITISCH: das Dokument behaelt eine ganze-Seiten-Mindesthoehe, auch bei wenig Inhalt',
      dokHoehe >= 900);
    check('KRITISCH: das Firmenlogo ist im Dokument eingebettet',
      await page.evaluate(() => {
        const img = document.querySelector('#dokumentSeite img');
        return !!img && img.naturalWidth > 0;
      }));
    check('Absender-Adresse (Fusszeile des Betriebs) steht oben im Dokument',
      /Musterweg 1/.test(await page.textContent('#dokumentSeite')));

    // ── Betriebs-Fusszeile am unteren Blattrand (Projektinhaber-Vorgabe,
    // 28.08.2026) -- dieselben Angaben wie oben im Absender-Block stehen
    // NOCH EINMAL unten, wie im internen Ausdruck (bkFusszeile()).
    check('KRITISCH: die zweite Betriebs-Fusszeile steht am unteren Blattrand',
      /info@cupi24\.ch/.test(await page.textContent('#dokumentSeite'))
      && /CHE-255\.301\.179/.test(await page.textContent('#dokumentSeite')));
    check('KRITISCH: kein doppelter Zeilenumbruch in der Fusszeile (nl2br + white-space:pre-line)',
      await page.evaluate(() => {
        const bloecke = [...document.querySelectorAll('#dokumentSeite div[style*="white-space:pre-line"]')];
        const fuss = bloecke.find(b => b.textContent.includes('info@cupi24.ch'));
        return !!fuss && !fuss.innerHTML.includes('<br>');
      }));

    // ── Empfaenger-Adresse ganz aussen rechts (Projektinhaber-Vorgabe) ────
    const empfaengerBox = await page.locator('#dokumentSeite').getByText('abc consulting gmbh').boundingBox();
    const toolbarBox = await page.locator('#btnHerunterladen').boundingBox();
    check('KRITISCH: die Empfaenger-Adresse reicht bis an denselben rechten Rand wie die Werkzeugleiste',
      Math.abs((empfaengerBox.x + empfaengerBox.width) - (toolbarBox.x + toolbarBox.width)) < 5);

    let druckAufgerufen = false;
    await page.exposeFunction('__druckMarker', () => { druckAufgerufen = true; });
    await page.evaluate(() => { window.print = () => window.__druckMarker(); });
    await page.click('button:has-text("Drucken")');
    await page.waitForTimeout(100);
    check('KRITISCH: "Drucken" ruft window.print() auf', druckAufgerufen);

    check('KRITISCH: "Herunterladen" ist da', await page.isVisible('#btnHerunterladen'));
    await page.click('#btnHerunterladen');
    await page.waitForFunction(() => typeof html2pdf !== 'undefined', { timeout: 15000 }).catch(() => {});
    const pdfGroesse = await page.evaluate(async () => {
      if (typeof html2pdf === 'undefined') { return -1; }
      const blob = await html2pdf().set({ margin: 10 }).from(document.getElementById('dokumentSeite')).outputPdf('blob');
      return blob.size;
    });
    check('KRITISCH: "Herunterladen" erzeugt tatsaechlich eine PDF-Datei mit plausibler Groesse',
      pdfGroesse > 1000);
    await page.close();
  }

  // ── rechnung_qr: QR-Zahlteil erscheint, mit IBAN/Referenz/Betrag ────────
  {
    const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
    const fehler = [];
    page.on('pageerror', e => fehler.push(e.message));
    await page.goto(url('rechnung_qr'), { waitUntil: 'load' });
    await page.waitForTimeout(200);
    check('KRITISCH: keine JS-Fehler beim QR-Rendern', fehler.length === 0);
    check('KRITISCH: der QR-Zahlteil erscheint mit hinterlegter QR-IBAN',
      await page.isVisible('text=Zahlung per QR-Rechnung'));
    check('Die IBAN steht gruppiert da', /CH44 3199 9123 0008 8901 2/.test(await page.textContent('#dokumentSeite')));
    check('KRITISCH: der QR-Code ist ein echtes SVG mit Modulen (kein Platzhalter)',
      await page.evaluate(() => {
        const svg = document.querySelector('#qrRechnungCode svg');
        return !!svg && svg.querySelectorAll('path,rect').length > 0;
      }));
    await page.close();
  }

  // ── offerte_offen: Annehmen/Ablehnen stehen links, keine Rechnungsfelder ─
  {
    const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
    await page.goto(url('offerte_offen'), { waitUntil: 'load' });
    check('KRITISCH: Annehmen/Ablehnen stehen in der Zusammenfassung',
      /Ablehnen/.test(await page.textContent('.zusammenfassung'))
      && /Annehmen/.test(await page.textContent('.zusammenfassung')));
    check('KRITISCH: kein QR-Zahlteil bei einer Offerte', !(await page.isVisible('text=Zahlung per QR-Rechnung')));
    check('KRITISCH: ohne angehakte Unterschriftsseite steht kein Unterschriftsblock im Dokument',
      !(await page.isVisible('text=Ort, Datum')));
    await page.close();
  }

  // ── offerte_unterschrift: Unterschriftsseite (ENT-207) ──────────────────
  {
    const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
    const fehler = [];
    page.on('pageerror', e => fehler.push(e.message));
    await page.goto(url('offerte_unterschrift'), { waitUntil: 'load' });
    check('KRITISCH: keine JS-Fehler mit angehakter Unterschriftsseite', fehler.length === 0);
    check('KRITISCH: die Unterschriftsseite steht im Dokument (Ort, Datum, zwei Unterschriftsfelder)',
      /Ort, Datum/.test(await page.textContent('#dokumentGanz'))
      && /Unterschrift abc consulting gmbh/.test(await page.textContent('#dokumentGanz'))
      && /Unterschrift Cupi 24 GmbH/.test(await page.textContent('#dokumentGanz')));
    check('KRITISCH: die Unterschriftsseite erzwingt einen Seitenumbruch (page-break-before)',
      await page.evaluate(() => {
        const bloecke = [...document.querySelectorAll('#dokumentGanz > div')];
        const letzte = bloecke[bloecke.length - 1];
        return !!letzte && letzte.getAttribute('style').includes('page-break-before:always')
          && letzte.textContent.includes('Ort, Datum');
      }));
    check('KRITISCH: "Herunterladen" fasst Dokument UND Unterschriftsseite in einer PDF zusammen',
      await page.evaluate(() => document.getElementById('dokumentGanz').contains(document.getElementById('dokumentSeite'))));
    await page.close();
  }

  // ── offerte_entschieden: Status statt Knoepfe ───────────────────────────
  {
    const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
    await page.goto(url('offerte_entschieden'), { waitUntil: 'load' });
    check('KRITISCH: eine bereits entschiedene Offerte zeigt "Angenommen", keine Knoepfe mehr',
      /Angenommen am/.test(await page.textContent('.zusammenfassung'))
      && !(await page.isVisible('button:has-text("Annehmen")')));
    await page.close();
  }

  // ── Mobil: die Spalten stapeln sich, nichts ueberlappt ──────────────────
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    const fehler = [];
    page.on('pageerror', e => fehler.push(e.message));
    await page.goto(url('rechnung_qr'), { waitUntil: 'load' });
    await page.waitForTimeout(200);
    check('KRITISCH: mobil keine JS-Fehler', fehler.length === 0);
    const zf = await page.locator('.zusammenfassung').boundingBox();
    const dok = await page.locator('.karte').boundingBox();
    check('KRITISCH: auf schmalem Bildschirm stehen die Spalten UNTEREINANDER, nicht ueberlappend',
      dok.y >= zf.y + zf.height - 2);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
