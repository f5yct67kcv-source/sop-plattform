// Software-Stand in der Supportansicht (ENT-696).
//
// Die Aussage: Wer im Cockpit unter Administration → Support nachsieht,
// liest ab, welcher Code in seinem Browser laeuft -- und ist der Stand
// unbekannt, steht dort "nicht bekannt", nie eine leere Stelle.
//
// Warum nicht einfach nachsehen, ob die Zeile im Quelltext steht: Der Wert
// entsteht erst im Deploy. Eine Ersetzung, die zu spaet laeuft (nach dem
// Kopieren in die Buendel) oder einen anderen Text sucht als den, der in
// dashboard.html steht, liesse jede Quelltextpruefung gruen und zeigte live
// "nicht bekannt". Darum fuehrt diese Suite den sed-Befehl AUS DEM WORKFLOW
// selbst aus und misst das Ergebnis im Browser.
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { execFileSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const workflow = readFileSync(`${WURZEL}/.github/workflows/deploy-hostpoint.yml`, 'utf8');
const quelle   = readFileSync(`${WURZEL}/dashboard.html`, 'utf8');

// ══════════════════════════════════════════════════════════════════════
// TEIL 1 — Der Deploy setzt den Stand ein, und zwar rechtzeitig
// ══════════════════════════════════════════════════════════════════════

// Der Platzhalter wird aus dashboard.html GELESEN, nicht hier abgeschrieben:
// Aendert jemand ihn nur an einer der beiden Stellen, muss das auffallen.
const platzhalter = (/const APP_STAND = '([^']*)';/.exec(quelle) || [])[1] || '';
check('dashboard.html traegt die Konstante APP_STAND mit einem Platzhalter', platzhalter.length > 3);

// Der Schritt, wie er im Workflow steht -- bis zum naechsten Schritt.
function standSchritt(text) {
  const i = text.indexOf('- name: Software-Stand in dashboard.html einsetzen');
  if (i < 0) { return { block: '', pos: -1 }; }
  const rest = text.slice(i + 10);
  const ende = rest.search(/\n\s*- name:/);
  return { block: text.slice(i, ende < 0 ? undefined : i + 10 + ende), pos: i };
}

// Vor JEDEM Kopieren von dashboard.html, egal in welches Buendel. Laeuft die
// Ersetzung danach, erbt kein Buendel den Stand.
function rechtzeitig(text) {
  const { pos } = standSchritt(text);
  const erstesKopieren = text.search(/cp(\s+-\S+)*\s+dashboard\.html\s/);
  return pos > 0 && erstesKopieren > 0 && pos < erstesKopieren;
}

const { block } = standSchritt(workflow);
const sedZeile = (/^\s*(sed -i "s\|[^\n]*" dashboard\.html)\s*$/m.exec(block) || [])[1] || '';
check('KRITISCH: der Workflow hat einen Schritt, der den Stand in dashboard.html einsetzt', !!sedZeile);
check('KRITISCH: er ersetzt genau den Platzhalter, den dashboard.html traegt',
  !!platzhalter && sedZeile.includes(`s|${platzhalter}|`));
check('KRITISCH: er laeuft vor dem ersten Kopieren von dashboard.html in ein Buendel',
  rechtzeitig(workflow));
// Gegenprobe der Reihenfolgepruefung: derselbe Schritt ans Ende verschoben.
{
  const ohne = workflow.replace(block, '');
  const verschoben = ohne + '\n' + block;
  check('Gegenprobe: ein Schritt NACH dem Kopieren wird als zu spaet erkannt', !rechtzeitig(verschoben));
}
// Die Ersetzung darf die Deploy-Waechter nicht ausloesen: Die verlangen fuer
// jeden __X__-Platzhalter eine eigene Ersetzung je Buendel.
check('der Platzhalter hat nicht die Form __X__ (sonst schlagen die Buendel-Waechter an)',
  !/^__[A-Z0-9_]+__$/.test(platzhalter));

// Den echten Befehl ausfuehren -- mit Werten, wie git sie liefert.
function ausgeliefert(datum, kurz) {
  if (!sedZeile) { return quelle; }
  // Derselbe Befehl, nur ohne -i und ohne Dateinamen: Er liest die Quelle
  // von der Standardeingabe und schreibt das Ergebnis heraus, statt die
  // Datei im Repository zu veraendern.
  const befehl = sedZeile.replace(/^sed -i /, 'sed ').replace(/\s+dashboard\.html$/, '');
  const skript = `STAND_DATUM='${datum}'; STAND_KURZ='${kurz}'; ${befehl}`;
  return execFileSync('bash', ['-c', skript], { input: quelle, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}
// Kein Datum nahe beim heutigen Tag (test_datumsfest.mjs): Der Wert ist
// hier reiner Text, er darf trotzdem nicht so aussehen, als haenge er davon ab.
const DATUM = '2025-03-04', KURZ = 'a3f9c1e';
const deployt = ausgeliefert(DATUM, KURZ);
check('KRITISCH: nach dem Einsetzen steht kein Platzhalter mehr in dashboard.html',
  !!platzhalter && !deployt.includes(platzhalter));

// ══════════════════════════════════════════════════════════════════════
// TEIL 2 — Die Zeile wird GEMESSEN
// ══════════════════════════════════════════════════════════════════════
const browser = await chromium.launch({ executablePath: browserPfad() });

// Ueber eine erfundene Adresse ausliefern statt per file:// -- nur so laesst
// sich die deployte Fassung zeigen, ohne eine Datei ins Repository zu legen.
// Was an support_anfrage.php hinausging -- gelesen am Netz, nicht am Code.
const gesendet = [];
async function seiteMit(html, breite) {
  const seite = await browser.newPage({ viewport: { width: breite, height: 900 } });
  await seite.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'pruef.lokal') { return route.abort(); }
    if (url.pathname.startsWith('/api/')) {
      const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
      if (url.pathname.endsWith('/support_anfrage.php') && route.request().method() === 'POST') {
        gesendet.push(JSON.parse(route.request().postData() || '{}'));
        return send({ status: 'ok', id: 1, post: 'ok' });
      }
      if (url.pathname.includes('login')) { return send({ status: 'ok', token: 't', name: 'a', ist_admin: true }); }
      return send({ status: 'ok', einsaetze: [], kunden: [], rapporte: [], objekte: [], vorgaenge: [],
                    mitarbeiter: [], feiertage: [], gepflegt: {}, sperren: [] });
    }
    if (url.pathname === '/dashboard.html') {
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    }
    const datei = join(WURZEL, decodeURIComponent(url.pathname));
    if (!datei.startsWith(WURZEL) || !existsSync(datei)) { return route.fulfill({ status: 404, body: '' }); }
    return route.fulfill({ status: 200, path: datei });
  });
  await seite.goto('http://pruef.lokal/dashboard.html');
  await seite.fill('#gName', 'a'); await seite.fill('#gPass', 'x'); await seite.click('#gBtn');
  await seite.waitForSelector('#shell.on');
  await seite.waitForTimeout(300);
  await seite.evaluate(() => go('support'));
  await seite.waitForTimeout(200);
  return seite;
}

function messen(seite) {
  return seite.evaluate(() => {
    const zeile = document.getElementById('spStand');
    const wert = document.getElementById('spStandWert');
    if (!zeile || !wert) { return null; }
    const r = zeile.getBoundingClientRect();
    const reiter = document.getElementById('spReiter').getBoundingClientRect();
    const panel = [...document.querySelectorAll('#view-support .rdkr-panel')]
      .find(p => p.offsetParent !== null);
    const pr = panel ? panel.getBoundingClientRect() : null;
    return {
      sichtbar: zeile.offsetParent !== null && r.height > 0,
      text: wert.textContent.trim(),
      schrift: parseFloat(getComputedStyle(wert).fontSize),
      unterReiter: r.top >= reiter.bottom - 1,
      uberPanel: pr ? r.bottom <= pr.top + 1 : false,
      // Links buendig mit dem Inhalt darunter, nicht irgendwo im Raum.
      linksBuendig: pr ? Math.abs(r.left - pr.left) <= 1 : false,
    };
  });
}

// ── Ausgeliefert: der Stand steht da ──
{
  const seite = await seiteMit(deployt, 1400);
  const m = await messen(seite);
  check('KRITISCH: am Desktop steht der Software-Stand in der Supportansicht', m && m.sichtbar);
  check('KRITISCH: er zeigt Datum und Kurzkennung aus dem Deploy',
    m && m.text === `${DATUM} · ${KURZ}`);
  check('Die Zeile steht zwischen Reiterleiste und Inhalt', m && m.unterReiter && m.uberPanel);
  check('Die Zeile ist links buendig mit dem Inhalt darunter', m && m.linksBuendig);
  check('Der Wert ist lesbar (mindestens 12 px)', m && m.schrift >= 12);
  await seite.close();
}

// ── Nicht ueber den Deploy: "nicht bekannt", nie leer ──
{
  const seite = await seiteMit(quelle, 1400);
  const m = await messen(seite);
  check('KRITISCH: ohne Deploy steht "nicht bekannt" statt einer leeren Stelle',
    m && m.sichtbar && /nicht bekannt/.test(m.text));
  check('KRITISCH: ohne Deploy erscheint nie der rohe Platzhalter',
    m && !!platzhalter && !m.text.includes(platzhalter));
  await seite.close();
}

// ── Ein kaputter Wert gilt als unbekannt, nicht als Stand ──
{
  const seite = await seiteMit(ausgeliefert('', ''), 1400);
  const m = await messen(seite);
  check('Ein leer eingesetzter Stand zeigt "nicht bekannt"', m && /nicht bekannt/.test(m.text));
  await seite.close();
}

// ── Die Supportanfrage schickt den Stand mit (ENT-696, Weg 1) ──
//
// Geprueft wird, was beim Server ANKOMMT: Eine Anfrage, die den Stand nur
// im Formular zeigt, aber nicht mitsendet, nuetzt dem Betreiber nichts.
async function anfrageSenden(html) {
  gesendet.length = 0;
  const seite = await seiteMit(html, 1400);
  await seite.evaluate(() => spReiterZeigen('melden'));
  await seite.fill('#saBetreff', 'Rundgang bricht ab');
  await seite.fill('#saText', 'Beim dritten Punkt.');
  await seite.evaluate(() => saSenden());
  await seite.waitForTimeout(300);
  await seite.close();
  return gesendet[0] || null;
}
{
  const mit = await anfrageSenden(deployt);
  check('KRITISCH: die Supportanfrage geht hinaus', !!mit);
  check('KRITISCH: sie traegt den ausgelieferten Stand in der Umgebung',
    !!mit && String(mit.umgebung || '').includes(`${DATUM} · ${KURZ}`));
  // Die bisherigen Angaben bleiben: angehaengt, nicht ersetzt.
  check('Browser und Fenstergroesse stehen weiterhin darin',
    !!mit && /\d+×\d+/.test(String(mit.umgebung || '')));
  check('Die Umgebung passt in das Feld der Betreiber-Datenbank (200 Zeichen)',
    !!mit && String(mit.umgebung || '').length <= 200);

  const ohne = await anfrageSenden(quelle);
  check('KRITISCH: ohne Deploy meldet die Anfrage "Stand nicht bekannt", statt ihn wegzulassen',
    !!ohne && /Stand nicht bekannt/.test(String(ohne.umgebung || '')));
  check('KRITISCH: ohne Deploy geht nie der rohe Platzhalter hinaus',
    !!ohne && !!platzhalter && !String(ohne.umgebung || '').includes(platzhalter));
}

// ── Am Handy ausgeblendet (ENT-235: mobile Umsetzung ist eigene Entscheidung) ──
{
  const seite = await seiteMit(deployt, 390);
  const m = await messen(seite);
  check('Am Handy erscheint die Zeile nicht', m && !m.sichtbar);
  await seite.close();
}

await browser.close();

console.log(`\nSoftware-Stand: ${ok.length} gruen, ${bad.length} rot`);
for (const n of bad) { console.log('  ✗ ' + n); }
process.exit(bad.length ? 1 : 0);
