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

// Der Platzhalter wird aus den Dateien GELESEN, nicht hier abgeschrieben:
// Aendert jemand ihn nur an einer Stelle, muss das auffallen.
const appQuelle = readFileSync(`${WURZEL}/app.html`, 'utf8');
const platzhalterAus = t => (/const APP_STAND = '([^']*)';/.exec(t) || [])[1] || '';
const platzhalter = platzhalterAus(quelle);
check('dashboard.html traegt die Konstante APP_STAND mit einem Platzhalter', platzhalter.length > 3);
check('app.html traegt denselben Platzhalter wie dashboard.html',
  !!platzhalter && platzhalterAus(appQuelle) === platzhalter);

// Der Schritt, wie er im Workflow steht -- bis zum naechsten Schritt.
function standSchritt(text) {
  const i = text.search(/- name: Software-Stand in [^\n]*einsetzen/);
  if (i < 0) { return { block: '', pos: -1 }; }
  const rest = text.slice(i + 10);
  const ende = rest.search(/\n\s*- name:/);
  return { block: text.slice(i, ende < 0 ? undefined : i + 10 + ende), pos: i };
}

// Vor JEDEM Kopieren der Datei, egal in welches Buendel. Laeuft die
// Ersetzung danach, erbt kein Buendel den Stand.
function rechtzeitig(text, datei) {
  const { pos } = standSchritt(text);
  const erstesKopieren = text.search(new RegExp(`cp(\\s+-\\S+)*\\s+${datei.replace('.', '\\.')}\\s`));
  return pos > 0 && erstesKopieren > 0 && pos < erstesKopieren;
}

const { block } = standSchritt(workflow);
// Die sed-Zeile und die Dateien, auf die sie wirkt.
const sedTreffer = /^\s*(sed -i "s\|[^\n]*")((?:\s+[\w.-]+\.html)+)\s*$/m.exec(block);
const sedZeile = sedTreffer ? sedTreffer[1] : '';
const sedDateien = sedTreffer ? sedTreffer[2].trim().split(/\s+/) : [];
check('KRITISCH: der Workflow hat einen Schritt, der den Stand einsetzt', !!sedZeile);
check('KRITISCH: er ersetzt genau den Platzhalter, den die Dateien tragen',
  !!platzhalter && sedZeile.includes(`s|${platzhalter}|`));
for (const datei of ['dashboard.html', 'app.html']) {
  check(`KRITISCH: er wirkt auf ${datei}`, sedDateien.includes(datei));
  check(`KRITISCH: er laeuft vor dem ersten Kopieren von ${datei} in ein Buendel`,
    rechtzeitig(workflow, datei));
}
// Gegenprobe der Reihenfolgepruefung: derselbe Schritt ans Ende verschoben.
{
  const ohne = workflow.replace(block, '');
  const verschoben = ohne + '\n' + block;
  check('Gegenprobe: ein Schritt NACH dem Kopieren wird als zu spaet erkannt',
    !rechtzeitig(verschoben, 'dashboard.html') && !rechtzeitig(verschoben, 'app.html'));
}
// Die Ersetzung darf die Deploy-Waechter nicht ausloesen: Die verlangen fuer
// jeden __X__-Platzhalter eine eigene Ersetzung je Buendel.
check('der Platzhalter hat nicht die Form __X__ (sonst schlagen die Buendel-Waechter an)',
  !/^__[A-Z0-9_]+__$/.test(platzhalter));

// Den echten Befehl ausfuehren -- mit Werten, wie git sie liefert.
// Derselbe Befehl, nur ohne -i und ohne Dateinamen: Er liest die Quelle von
// der Standardeingabe und schreibt das Ergebnis heraus, statt die Datei im
// Repository zu veraendern.
function ausgeliefert(datum, kurz, text = quelle) {
  if (!sedZeile) { return text; }
  const befehl = sedZeile.replace(/^sed -i /, 'sed ');
  const skript = `STAND_DATUM='${datum}'; STAND_KURZ='${kurz}'; ${befehl}`;
  return execFileSync('bash', ['-c', skript], { input: text, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}
// Kein Datum nahe beim heutigen Tag (test_datumsfest.mjs): Der Wert ist
// hier reiner Text, er darf trotzdem nicht so aussehen, als haenge er davon ab.
const DATUM = '2025-03-04', KURZ = 'a3f9c1e';
const deployt = ausgeliefert(DATUM, KURZ);
const appDeployt = ausgeliefert(DATUM, KURZ, appQuelle);
check('KRITISCH: nach dem Einsetzen steht kein Platzhalter mehr in dashboard.html',
  !!platzhalter && !deployt.includes(platzhalter));
check('KRITISCH: nach dem Einsetzen steht kein Platzhalter mehr in app.html',
  !!platzhalter && !appDeployt.includes(platzhalter));

// ══════════════════════════════════════════════════════════════════════
// TEIL 1b — aufs-handy.sh setzt den Stand ins Handy-Buendel
// ══════════════════════════════════════════════════════════════════════
//
// Die native App laeuft nicht ueber den Deploy. Ihr Stand kommt aus
// aufs-handy.sh -- geprueft durch AUSFUEHREN der Funktion aus dem Skript
// in einem Wegwerf-Repository, nicht am Quelltext.
const handy = readFileSync(`${WURZEL}/aufs-handy.sh`, 'utf8');
const stueck = name => {
  const von = handy.indexOf(`${name}() {`);
  if (von === -1) { return null; }
  const bis = handy.indexOf('\n}\n', von);
  return bis === -1 ? null : handy.slice(von, bis + 3);
};
const standFn = stueck('stand_einsetzen');
check('KRITISCH: aufs-handy.sh hat eine pruefbare Funktion stand_einsetzen', !!standFn);
{
  const aufruf = (/^stand_einsetzen\s+(.+)$/m.exec(handy) || [])[1] || '';
  check('KRITISCH: aufs-handy.sh setzt den Stand in die App (index.html) und ins Cockpit (dashboard.html) des Buendels',
    /mobile\/www\/index\.html/.test(aufruf) && /mobile\/www\/dashboard\.html/.test(aufruf));
  // Die versionierten Dateien bekommen den Stand nur voruebergehend: Das
  // Zuruecksetzen muss scharf sein, BEVOR eingesetzt wird.
  const beiTrap = handy.search(/^\s*trap\s+buendel_zuruecksetzen\b/m);
  const beiStand = handy.search(/^stand_einsetzen\s/m);
  check('KRITISCH: das Zuruecksetzen ist scharf, bevor der Stand eingesetzt wird',
    beiTrap !== -1 && beiStand !== -1 && beiTrap < beiStand);
  // ... und nach dem Erzeugen des Buendels, sonst ueberschriebe das ihn.
  const beiErzeugen = handy.search(/^python3 mobile-buendel-erstellen\.py/m);
  check('KRITISCH: der Stand wird nach dem Erzeugen des Buendels eingesetzt',
    beiErzeugen !== -1 && beiStand > beiErzeugen);
  // ... und vor cap sync, das die Dateien in die App kopiert.
  const beiSync = handy.search(/^npx cap sync/m);
  check('KRITISCH: der Stand wird vor "cap sync" eingesetzt', beiSync !== -1 && beiStand < beiSync);
}

// Ein Wegwerf-Repository mit einer Datei ausserhalb und einer innerhalb
// von mobile/www. Rueckgabe: der eingesetzte Stand.
const { mkdtempSync, writeFileSync, rmSync, mkdirSync } = await import('fs');
const { tmpdir } = await import('os');
function handyLauf(aendern) {
  const ordner = mkdtempSync(join(tmpdir(), 'stand-'));
  try {
    const sh = (c) => execFileSync('bash', ['-c', c], { cwd: ordner, encoding: 'utf8' });
    mkdirSync(join(ordner, 'mobile/www'), { recursive: true });
    writeFileSync(join(ordner, 'app.html'), 'quelle\n');
    writeFileSync(join(ordner, 'mobile/www/index.html'), `const APP_STAND = '${platzhalter}';\n`);
    sh('git init -q && git -c user.email=t@t -c user.name=t add -A && '
      + 'GIT_COMMITTER_DATE="2025-03-04T10:00:00+01:00" git -c user.email=t@t -c user.name=t commit -qm x');
    if (aendern) { aendern(ordner); }
    sh(`${standFn}\nstand_einsetzen mobile/www/index.html`);
    const inhalt = readFileSync(join(ordner, 'mobile/www/index.html'), 'utf8');
    const kurz = sh('git rev-parse --short=7 HEAD').trim();
    return { wert: platzhalterAus(inhalt), kurz };
  } finally { rmSync(ordner, { recursive: true, force: true }); }
}
if (standFn && platzhalter) {
  const sauber = handyLauf();
  check('KRITISCH: ein sauberer Bau traegt Commit-Datum und Kurzkennung',
    sauber.wert === `2025-03-04 · ${sauber.kurz}`);
  const lokal = handyLauf(o => writeFileSync(join(o, 'app.html'), 'geaendert\n'));
  check('KRITISCH: ein Bau mit ungesicherten Aenderungen sagt das ("+ lokal geändert")',
    lokal.wert === `2025-03-04 · ${lokal.kurz} + lokal geändert`);
  // Das Buendel selbst beschreibt der Bau -- das darf den Zusatz nicht ausloesen.
  const nurBuendel = handyLauf(o => writeFileSync(join(o, 'mobile/www/index.html'),
    `const APP_STAND = '${platzhalter}';\n// neu erzeugt\n`));
  check('Ein neu erzeugtes Buendel allein gilt nicht als lokale Aenderung',
    nurBuendel.wert === `2025-03-04 · ${nurBuendel.kurz}`);
  var handyStand = lokal.wert;   // fuer die Messung in der App unten
} else {
  ['KRITISCH: ein sauberer Bau traegt Commit-Datum und Kurzkennung',
   'KRITISCH: ein Bau mit ungesicherten Aenderungen sagt das ("+ lokal geändert")',
  ].forEach(n => check(n + ' (nicht pruefbar)', false));
}

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

// ══════════════════════════════════════════════════════════════════════
// TEIL 3 — Die Waechter-App: eigene Zeile ueber der Technikzeile
// ══════════════════════════════════════════════════════════════════════
async function appEinstellungen(html) {
  const seite = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await seite.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'pruef.lokal') { return route.abort(); }
    if (url.pathname.startsWith('/api/')) {
      const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
      if (url.pathname.includes('login')) { return send({ status: 'ok', token: 't', name: 'dario.beispiel', ist_admin: false }); }
      if (url.pathname.includes('rapport_list')) { return send({ status: 'ok', rapporte: [] }); }
      return send({ status: 'ok' });
    }
    if (url.pathname === '/app.html') {
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    }
    const datei = join(WURZEL, decodeURIComponent(url.pathname));
    if (!datei.startsWith(WURZEL) || !existsSync(datei)) { return route.fulfill({ status: 404, body: '' }); }
    return route.fulfill({ status: 200, path: datei });
  });
  await seite.goto('http://pruef.lokal/app.html');
  await seite.fill('#gName', 'dario.beispiel'); await seite.fill('#gPass', 'x'); await seite.click('#gBtn');
  await seite.waitForSelector('#app.on');
  await seite.waitForTimeout(400);
  await seite.evaluate(() => zeige('menu'));
  await seite.waitForTimeout(300);
  await seite.click('#mk-einstellungen');
  await seite.waitForTimeout(300);
  const m = await seite.evaluate(() => {
    const z = document.getElementById('appStand');
    if (!z) { return null; }
    const technik = z.nextElementSibling;
    const r = z.getBoundingClientRect(), t = technik ? technik.getBoundingClientRect() : null;
    const cs = getComputedStyle(z), ct = technik ? getComputedStyle(technik) : null;
    return {
      sichtbar: z.offsetParent !== null && r.height > 0,
      text: z.textContent.trim(),
      // Die Technikzeile ist die mit den Messwerten -- an ihrem Inhalt
      // erkannt, nicht an ihrer Position.
      technikDarunter: !!technik && /Bildschirm \S+ · Fenster/.test(technik.textContent)
        && t.top >= r.bottom - 1,
      gleicheSchrift: !!ct && cs.fontSize === ct.fontSize && cs.color === ct.color,
      schrift: parseFloat(cs.fontSize),
    };
  });
  await seite.close();
  return m;
}
{
  const m = await appEinstellungen(appDeployt);
  check('KRITISCH: die App zeigt den Stand unter Menü → Einstellungen', m && m.sichtbar);
  check('KRITISCH: er lautet "Stand" plus Datum und Kurzkennung aus dem Deploy',
    m && m.text === `Stand ${DATUM} · ${KURZ}`);
  check('Er steht als eigene Zeile direkt über der Technikzeile', m && m.technikDarunter);
  check('In derselben Schrift wie die Technikzeile', m && m.gleicheSchrift);
}
{
  const m = await appEinstellungen(appQuelle);
  check('KRITISCH: ohne Deploy sagt die App "Stand nicht bekannt", statt nichts zu zeigen',
    m && m.sichtbar && m.text === 'Stand nicht bekannt');
}
if (typeof handyStand === 'string') {
  // Der Wert aus aufs-handy.sh (mit Zusatz) muss als Stand gelten, nicht
  // als "nicht bekannt" -- sonst truege die App den Hinweis nie.
  const html = appQuelle.replace(`'${platzhalter}'`, `'${handyStand}'`);
  const m = await appEinstellungen(html);
  check('KRITISCH: ein Stand aus aufs-handy.sh mit "+ lokal geändert" wird angezeigt, nicht verworfen',
    m && m.text === `Stand ${handyStand}`);
}

await browser.close();

console.log(`\nSoftware-Stand: ${ok.length} gruen, ${bad.length} rot`);
for (const n of bad) { console.log('  ✗ ' + n); }
process.exit(bad.length ? 1 : 0);
