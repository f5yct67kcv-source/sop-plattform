// Der Verdichter (werkzeuge/verdichten/verdichten.mjs) entfernt beim Deploy
// die Kommentare aus den ausgelieferten Seiten. Was hier geprueft wird, ist
// das, was dabei kaputtgehen koennte -- nicht, ob ein bestimmtes Wort fehlt:
//
//   1. Jedes Skript der verdichteten Seiten laesst sich noch uebersetzen.
//      Ein "//" in einer Zeichenkette ("https://...") oder ein "/*" in
//      einem regulaeren Ausdruck, falsch als Kommentar gelesen, zerbraeche
//      genau hier.
//   2. Die verdichteten Seiten starten im Browser ohne JavaScript-Fehler,
//      das Cockpit bis nach der Anmeldung.
//   3. Sie sind tatsaechlich deutlich kleiner -- sonst lief das Werkzeug
//      ins Leere.
//   4. Im Deploy laeuft der Verdichter vor JEDEM Hochladen eines Buendels,
//      und zwar nach allen Schritten, die das Buendel noch veraendern.
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, cpSync } from 'fs';
import { gzipSync } from 'zlib';
import { join } from 'path';
import { tmpdir } from 'os';
import vm from 'vm';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

// Die Abhaengigkeit kommt per npm ci, wie im Deploy. Fehlt sie und laesst
// sie sich nicht holen, ist das ROT mit Grund -- nicht still uebersprungen,
// denn "nicht geprueft" darf nie wie "in Ordnung" aussehen.
const WERKZEUG = join(WURZEL, 'werkzeuge/verdichten');
if (!existsSync(join(WERKZEUG, 'node_modules/html-minifier-terser'))) {
  try { execFileSync('npm', ['ci', '--prefix', WERKZEUG, '--silent', '--no-audit', '--no-fund'], { stdio: 'ignore' }); }
  catch (e) { /* unten gemeldet */ }
}
if (!existsSync(join(WERKZEUG, 'node_modules/html-minifier-terser'))) {
  console.log('\n0 bestanden, 1 nicht bestanden\n');
  console.log('  ✗ Abhaengigkeit fehlt und liess sich nicht holen: npm ci --prefix werkzeuge/verdichten');
  process.exit(1);
}
const { verdichten } = await import(join(WERKZEUG, 'verdichten.mjs'));

const SEITEN = ['dashboard.html', 'app.html', 'betreiber.html', 'portal.html', 'index.html', 'homepage.html'];
const ZIEL = mkdtempSync(join(tmpdir(), 'verdichtet-'));
// Die Seiten laden Skripte, Schriften und Bilder relativ -- die gehoeren
// mit in den Ordner, sonst misst der Browsertest fehlende Dateien.
for (const d of ['gav.js', 'zeitwahl.js', 'testumgebung.js', 'unterschrift.js', 'qrcode.js', 'sw.js',
  'manifest.json', 'manifest-app.json', 'recht.css']) {
  if (existsSync(join(WURZEL, d))) cpSync(join(WURZEL, d), join(ZIEL, d));
}
for (const d of ['fonts', 'icons', 'img']) cpSync(join(WURZEL, d), join(ZIEL, d), { recursive: true });

const gz = s => gzipSync(Buffer.from(s)).length;
for (const seite of SEITEN) {
  const roh = readFileSync(join(WURZEL, seite), 'utf8');
  const neu = await verdichten(roh);
  writeFileSync(join(ZIEL, seite), neu);
  // 1. Jedes Inline-Skript (ohne src, kein JSON/Vorlage) uebersetzbar
  const skripte = [...neu.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .filter(m => !/\bsrc=/.test(m[1] || '') && !/type=["']?(application\/(ld\+)?json|text\/(template|html|plain))/i.test(m[1] || ''))
    .map(m => m[2]);
  const kaputt = [];
  skripte.forEach((code, i) => {
    try { new vm.Script(code, { filename: `${seite}#${i}` }); }
    catch (e) { kaputt.push(`Skript ${i}: ${e.message}`); }
  });
  check(`KRITISCH: ${seite} -- alle ${skripte.length} Skripte lassen sich nach dem Verdichten uebersetzen`,
    skripte.length > 0 && kaputt.length === 0);
  kaputt.slice(0, 3).forEach(k => bad.push(`   ↳ ${seite}: ${k}`));
  // 3. Spuerbar kleiner (komprimiert gemessen, so wie es uebertragen wird)
  const vorher = gz(roh), nachher = gz(neu);
  check(`${seite} ist komprimiert kleiner: ${Math.round(vorher / 1024)} -> ${Math.round(nachher / 1024)} KB`,
    nachher < vorher * 0.9);
  // HTML-Kommentare ausserhalb von Skripten sind weg (in Skripten koennen
  // "<!--" als Teil einer Zeichenkette vorkommen, die bleiben).
  const ohneSkripte = neu.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  check(`${seite}: keine HTML-Kommentare mehr ausserhalb der Skripte`, !/<!--[\s\S]*?-->/.test(ohneSkripte));
}
const cockpit = gz(readFileSync(join(ZIEL, 'dashboard.html'), 'utf8'));
check(`Das Cockpit schrumpft komprimiert unter 400 KB (${Math.round(cockpit / 1024)} KB)`, cockpit < 400 * 1024);

// ── 2. Im Browser: starten ohne JavaScript-Fehler
const browser = await chromium.launch({ executablePath: browserPfad() });
async function oeffnen(seite, anmelden) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const fehler = [];
  page.on('pageerror', e => fehler.push(e.message));
  await page.route('**/api/**', route => {
    const p = route.request().url().split('/api/')[1].split('?')[0];
    const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'chefin', ist_admin: true });
    if (p.includes('dashboard_stats')) return send({ status: 'ok',
      kpi: { rapporte_monat: 0, rapporte_vormonat: 0, stunden_monat: 0, stunden_vormonat: 0, mitarbeiter: 0, kunden: 0, rapporte_total: 0 },
      verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [] });
    return send({ status: 'ok', rapporte: [], mitarbeiter: [], einsaetze: [], kunden: [], objekte: [] });
  });
  await page.goto(`file://${join(ZIEL, seite)}`);
  let angemeldet = null;
  if (anmelden) {
    await page.fill('#gName', 'chefin'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
    angemeldet = await page.waitForSelector('#shell.on', { timeout: 8000 }).then(() => true).catch(() => false);
  }
  await page.waitForTimeout(500);
  await page.close();
  return { fehler, angemeldet };
}
const c = await oeffnen('dashboard.html', true);
check('KRITISCH: das verdichtete Cockpit startet und kommt bis nach der Anmeldung', c.angemeldet === true);
check('KRITISCH: … ohne JavaScript-Fehler', c.fehler.length === 0);
c.fehler.slice(0, 3).forEach(f => bad.push('   ↳ Cockpit: ' + f));
for (const seite of ['app.html', 'betreiber.html', 'portal.html', 'index.html', 'homepage.html']) {
  const r = await oeffnen(seite, false);
  check(`KRITISCH: das verdichtete ${seite} startet ohne JavaScript-Fehler`, r.fehler.length === 0);
  r.fehler.slice(0, 3).forEach(f => bad.push(`   ↳ ${seite}: ` + f));
}
await browser.close();

// ── 4. Im Deploy: vor jedem Hochladen, nach dem letzten Bauschritt
// Die Schritte werden aus dem Workflow gelesen, nicht aufgezaehlt: Kommt ein
// Buendel dazu, faellt es hier auf, wenn es ohne Verdichter hochgeht.
const wf = readFileSync(join(WURZEL, '.github/workflows/deploy-hostpoint.yml'), 'utf8');
const schritte = wf.split(/\n(?=      - (?:name|uses):)/);
const ohne = [];
schritte.forEach((st, i) => {
  const m = st.match(/local-dir:\s*\.\/(dist[^/\s]*)\//);
  if (!m) return;
  const buendel = m[1];
  // Rueckwaerts bis zum letzten Schritt, der dieses Buendel noch anfasst:
  // Davor muss ein "HTML verdichten" fuer dasselbe Buendel stehen, und
  // zwischen Verdichten und Hochladen darf nichts mehr hineinschreiben.
  let verdichtet = -1, zuletztGebaut = -1;
  for (let j = i - 1; j >= 0; j--) {
    if (verdichtet < 0 && new RegExp(`verdichten\\.mjs ${buendel}\\b`).test(schritte[j])) verdichtet = j;
    if (zuletztGebaut < 0 && !/verdichten\.mjs/.test(schritte[j]) && !/local-dir:/.test(schritte[j])
        && new RegExp(`(>|cp |sed |cat |mkdir |rm ).*${buendel}/`).test(schritte[j])) zuletztGebaut = j;
  }
  if (verdichtet < 0 || verdichtet < zuletztGebaut) ohne.push(`${buendel} (Schritt ${i})`);
});
check('KRITISCH: vor jedem Hochladen laeuft der Verdichter, nach dem letzten Bauschritt des Buendels', ohne.length === 0);
ohne.forEach(o => bad.push('   ↳ ohne Verdichter oder zu frueh: ' + o));
check('Der Verdichter wird vorher eingerichtet (npm ci mit fester Fassung)',
  /npm ci --prefix werkzeuge\/verdichten/.test(wf) && existsSync(join(WERKZEUG, 'package-lock.json')));

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
