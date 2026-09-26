// Der Start des Betreiberbereichs laedt seine Listen GLEICHZEITIG
// (ladeAlles, 2026-09-26). Vorher wartete jede Liste auf alle davor: Der
// Start dauerte so lange wie alle Abrufe zusammen, und warf eine Liste
// einen Fehler, blieben alle dahinter leer.
//
// Geprueft am Verhalten, mit einem nachgebauten Server, der jede Antwort
// 200 ms zurueckhaelt:
//   - Alle unabhaengigen Listen sind unterwegs, bevor die erste antwortet.
//   - Leistungen, Offerten und Rechnungen fragen erst NACH dem Adressbuch
//     -- sie lesen beim Zeichnen, ob der Offertenteil eingerichtet ist,
//     und das sagt erst das Adressbuch (offertenBereit).
//   - Wirft eine Liste, laden die anderen trotzdem fertig.
import { chromium } from 'playwright';
import { WURZEL, browserPfad } from './pfade.mjs';
import { pathToFileURL } from 'url';
import { join } from 'path';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);
const browser = await chromium.launch({ executablePath: browserPfad() });
const ADRESSE = pathToFileURL(join(WURZEL, 'betreiber.html')).href;
const BREMSE = 200;

async function start(werfen) {
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
  await page.goto(ADRESSE);
  await page.evaluate(({ werfen, BREMSE }) => {
    document.getElementById('tor').classList.add('versteckt');
    document.getElementById('haus').classList.remove('versteckt');
    window.__rufe = [];
    const t0 = performance.now();
    ruf = async (pfad, daten, methode) => {
      const eintrag = { pfad: pfad.split('?')[0] + (pfad.includes('art=') ? '?' + pfad.split('?')[1] : ''),
        ab: performance.now() - t0, bis: null, adressenFertig: !!window.__adressenFertig };
      window.__rufe.push(eintrag);
      await new Promise(r => setTimeout(r, BREMSE));
      eintrag.bis = performance.now() - t0;
      if (werfen && pfad.startsWith(werfen)) { throw new Error('Liste kaputt'); }
      if (pfad === 'betreiber_kunden_list.php') {
        window.__adressenFertig = true;
        return { status: 'ok', eingerichtet: true, kunden: [], naechste_nummer: 'K-1' };
      }
      if (pfad === 'betreiber_produkt_list.php') return { status: 'ok', eingerichtet: true, produkte: [] };
      if (pfad.startsWith('betreiber_beleg_list.php')) return { status: 'ok', eingerichtet: true, belege: [] };
      if (pfad === 'betreiber_mandant_list.php') return { status: 'ok', mandanten: [] };
      if (pfad === 'betreiber_konto_list.php') return { status: 'ok', konten: [], aktive: 0, archivierte: 0 };
      if (pfad === 'betreiber_neuerungen.php') return { status: 'ok', neueste: 0, gesehen_bis: 0, neuerungen: [] };
      if (pfad === 'betreiber_schema_pruefen.php') return { status: 'ok', getan: [], offen: [], fehler: [], mandanten: [] };
      return { status: 'ok' };
    };
  }, { werfen, BREMSE });
  const dauer = await page.evaluate(async () => {
    const t = performance.now();
    // Eine Ausnahme hier ist selbst ein Befund (die Kette brach ab) -- die
    // Pruefungen unten sagen dann, was dahinter nicht mehr lud.
    try { await ladeAlles(); } catch (e) { /* siehe unten */ }
    return performance.now() - t;
  });
  const rufe = await page.evaluate(() => window.__rufe);
  return { page, dauer, rufe };
}

// ── Normalfall
let { page, dauer, rufe } = await start(null);
const ruf = p => rufe.find(r => r.pfad === p);
const ersteAntwort = Math.min(...rufe.filter(r => r.bis !== null).map(r => r.bis));
const UNABHAENGIG = ['betreiber_mandant_list.php', 'betreiber_demo_list.php', 'betreiber_konto_list.php',
  'betreiber_kunden_list.php', 'betreiber_briefkopf.php', 'betreiber_support_vorgang.php'];
const fehlen = UNABHAENGIG.filter(p => !ruf(p));
check('Alle Listen werden beim Start abgefragt', fehlen.length === 0);
fehlen.forEach(p => bad.push('   ↳ nicht abgefragt: ' + p));
const spaet = UNABHAENGIG.filter(p => ruf(p) && ruf(p).ab >= ersteAntwort);
check('KRITISCH: die unabhaengigen Listen sind alle unterwegs, bevor die erste antwortet', spaet.length === 0);
spaet.forEach(p => bad.push('   ↳ wartete auf eine andere Liste: ' + p));
const ABHAENGIG = ['betreiber_produkt_list.php', 'betreiber_beleg_list.php?art=offerte', 'betreiber_beleg_list.php?art=rechnung'];
check('KRITISCH: Leistungen, Offerten und Rechnungen fragen erst nach dem Adressbuch',
  ABHAENGIG.every(p => ruf(p) && ruf(p).adressenFertig));
check('Leistungen, Offerten und Rechnungen laufen untereinander gleichzeitig',
  ABHAENGIG.every(p => ruf(p) && ruf(p).ab < Math.min(...ABHAENGIG.map(q => ruf(q).bis))));
// Nacheinander waeren es ueber zehn Abrufe mal 200 ms. Gleichzeitig zwei
// Stufen (Adressbuch, dann die drei Listen) -- mit reichlich Luft.
check(`KRITISCH: der Start dauert ungefaehr zwei Abrufe, nicht die Summe aller (${Math.round(dauer)} ms)`,
  dauer < BREMSE * 4);
await page.close();

// ── Eine Liste wirft: die anderen laden trotzdem fertig
({ page, dauer, rufe } = await start('betreiber_mandant_list.php'));
check('KRITISCH: wirft die Mandantenliste, werden die Offerten trotzdem geladen',
  rufe.some(r => r.pfad === 'betreiber_beleg_list.php?art=offerte' && r.bis !== null));
check('… und der Supportkanal auch', rufe.some(r => r.pfad === 'betreiber_support_vorgang.php' && r.bis !== null));
await page.close();

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
