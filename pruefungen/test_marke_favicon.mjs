// Das Zeichen im Reiter: Favicon, Reitername und die Icon-Dateien in den
// Buendeln (Befund des Projektinhabers, Lauf 525 -- Bildschirmfoto der
// Reiterliste).
//
// WARUM DIESE SUITE: In der Reiterliste stehen die fuenf Adressen der
// Plattform NEBENEINANDER, und genau dort fiel auf, was einzeln nie
// auffaellt:
//
//   1. Das Cockpit trug auf JEDER Adresse das Siegel der Mandantin
//      (icons/icon-*.png) -- auch auf der Demo und auf der geteilten
//      Rapport-Adresse, wo gar kein Mandant gemeint ist. ENT-568 sagt:
//      die geteilten Flaechen gehoeren der Betreiberin.
//   2. Kundenportal und Betreiber-Bereich hatten GAR KEIN Favicon. Der
//      Browser zeigt dann einen Buchstaben-Platzhalter -- und "kein
//      Favicon" sieht in der Reiterliste genauso aus wie "Seite noch
//      nicht geladen". Beide Adressen sahen damit gleich aus.
//   3. Das Logo im Kopf des Kundenportals (icons/guardops-192.png) fehlte
//      dem Buendel dist-portal/ ganz. Auf der geteilten Adresse lag die
//      Datei da (dort kommt icons/*.png mit), auf portal.guardops.ch
//      nicht -- lokal faellt so etwas NIE auf.
//
// GEPRUEFT WIRD DIE AUSSAGE, NICHT DER WORTLAUT: Die verlangten Dateinamen
// stehen nicht in dieser Datei, sondern werden aus den <link>- und
// <img>-Verweisen der Seiten GELESEN und gegen die cp-Zeilen des
// Buendels gehalten, das die jeweilige Seite ausliefert. Wer morgen ein
// anderes Icon verlinkt, muss hier nichts aendern -- wer es aber im Deploy
// vergisst, wird rot.
import { chromium } from 'playwright';
import { WURZEL, browserPfad } from './pfade.mjs';
import { readFileSync, existsSync } from 'fs';
import { pathToFileURL } from 'url';
import { join } from 'path';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);
const lies = d => readFileSync(`${WURZEL}/${d}`, 'utf8');

const workflow = lies('.github/workflows/deploy-hostpoint.yml');
const schritt = (name) => {
  const i = workflow.indexOf(`- name: ${name}`);
  if (i < 0) { return ''; }
  const j = workflow.indexOf('\n      - name:', i + 10);
  return workflow.slice(i, j < 0 ? undefined : j);
};

// NUR DIE ECHTEN cp-ZEILEN, nicht der Kommentartext daneben -- dieselbe
// Lehre wie in test_deploy.mjs: Nimmt man eine cp-Zeile heraus, bleibt der
// Dateiname im Kommentar darueber stehen. Eine Pruefung, die nur nach dem
// Namen sucht, bliebe gruen.
// Eine sed-Zeile samt ihrer Fortsetzungszeilen: In YAML steht die
// Dateiliste oft erst hinter einem "\" auf der naechsten Zeile. Wer nur
// die erste Zeile liest, sieht die Dateien nicht, auf die die Ersetzung
// wirkt -- und haelt eine Ersetzung fuer wirkungslos, die greift.
const sedErsetzungen = (text) => {
  const treffer = [];
  const zeilen = text.split('\n');
  for (let i = 0; i < zeilen.length; i++) {
    const m = zeilen[i].match(/sed -i "s\|(icons\/[^|]+)\|(icons\/[^|]+)\|g?"(.*)$/);
    if (!m) { continue; }
    let rest = m[3];
    let k = i;
    while (/\\\s*$/.test(zeilen[k]) && k + 1 < zeilen.length) { k++; rest += ' ' + zeilen[k]; }
    treffer.push({ von: m[1], nach: m[2], dateien: rest });
  }
  return treffer;
};

const cpZeilen = (text) => [...text.matchAll(/^\s*cp\s+(\S+)\s+(\S+)\s*$/gm)]
  .map(m => ({ von: m[1], nach: m[2] }));
const alsMuster = q => new RegExp('^' + q.split('*')
  .map(x => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$');
const wirdKopiert = (zeilen, pfad) => zeilen.some(z => alsMuster(z.von).test(pfad));

// Jeder Verweis auf eine eigene Icon-Datei -- Favicon, Haus-Symbol fuers
// Telefon, Vorschaubild UND das Logo im Seitenkopf. Bewusst alle vier in
// einem: Sie haengen alle als Dateiname im HTML und fehlen im Buendel auf
// genau dieselbe Weise.
const iconVerweise = (html) => [...new Set([
  ...[...html.matchAll(/<link[^>]+href="(icons\/[^"]+)"/g)].map(m => m[1]),
  ...[...html.matchAll(/<(?:img|meta)[^>]+(?:src|content)="(icons\/[^"]+)"/g)].map(m => m[1]),
])];
// Nur die Zeilen, die das Zeichen IM REITER setzen (rel="icon"), nicht das
// Haus-Symbol und nicht das Logo im Kopf.
const faviconVerweise = (html) => [...html.matchAll(/<link\s+rel="icon"[^>]+href="(icons\/[^"]+)"/g)]
  .map(m => m[1]);

// ── 1. Jede Oberflaeche, die in einem Reiter aufgeht, hat ein Favicon ────
//
// Die Liste sind die HTML-Huellen, die ein Mensch im Browser oeffnet --
// nicht mobile/www/ (dieselbe Datei, in die App gebuendelt, dort gibt es
// keinen Reiter).
const SEITEN = ['index.html', 'dashboard.html', 'app.html', 'portal.html',
  'betreiber.html', 'homepage.html', 'impressum.html', 'datenschutz.html'];

for (const seite of SEITEN) {
  const html = lies(seite);
  const fav = faviconVerweise(html);
  check(`KRITISCH: ${seite} setzt ein Favicon — ohne eines zeigt der Browser einen Buchstaben-Platzhalter, und der sieht aus wie "noch nicht geladen"`,
    fav.length > 0);
  check(`KRITISCH: ${seite} trägt im Reiter die Marke der Plattform, nicht das Siegel der Mandantin (ENT-568) — cupi24.guardops.ch hängt es im Deploy selbst um`,
    fav.length > 0 && fav.every(f => /^icons\/guardops-/.test(f)));
  for (const v of iconVerweise(html)) {
    check(`${seite} verweist auf ${v} — die Datei gibt es`, existsSync(`${WURZEL}/${v}`));
  }
  // Ein Reitername, der nur die Anwendung nennt, steht in der Reiterliste
  // mehrfach gleich da -- genau der Befund aus Lauf 525. Geprueft wird
  // darum, dass er ueberhaupt einen gibt UND dass keine zwei der acht
  // Seiten denselben tragen (weiter unten).
  check(`${seite} hat einen Reitername`, /<title>[^<]{3,}<\/title>/.test(html));
}

// Zwei Seiten mit demselben Reitername sind in der Reiterliste nicht
// auseinanderzuhalten. dashboard.html und app.html duerfen sich den Namen
// teilen (dieselbe Anwendung, Desktop und Handy -- und auf dem Handy gibt
// es die Reiterliste so nicht); alle uebrigen nicht.
{
  const titel = {};
  for (const seite of SEITEN) {
    const m = lies(seite).match(/<title>([^<]+)<\/title>/);
    titel[seite] = m ? m[1].trim() : '';
  }
  const doppelt = Object.entries(titel).filter(([s, t]) =>
    Object.entries(titel).some(([s2, t2]) => s2 !== s && t2 === t)
    && ![ 'dashboard.html', 'app.html' ].includes(s));
  check('KRITISCH: keine zwei Oberflächen tragen denselben Reitername (Cockpit und Mitarbeiter-App ausgenommen — dieselbe Anwendung)',
    doppelt.length === 0);
  if (doppelt.length) { bad.push('gleicher Reitername: ' + doppelt.map(([s, t]) => `${s}="${t}"`).join(', ')); }

  // Der Betreiber-Bereich sagt im Reiter, WELCHES Produkt -- er steht neben
  // vier weiteren GuardOpS-Adressen. Geprueft wird die Aussage (Marke im
  // Namen), nicht der genaue Wortlaut.
  check('KRITISCH: der Reitername des Betreiber-Bereichs nennt die Marke',
    /guardops/i.test(titel['betreiber.html']));
}

// ── 2. Die Demo sagt im Reiter, dass sie die Demo ist ────────────────────
//
// dashboard.html setzt document.title beim Start SELBST (APP_NAME) -- das
// <title> im Kopf ist damit nur der Zustand vor dem Skript. Wer die Demo
// am <title> unterscheiden wollte, aenderte die falsche Stelle. Die
// Umgebung kommt aus dem Deploy (window.APP_UMGEBUNG_DEMO aus
// testumgebung.js), NIE aus dem Hostnamen -- dieselbe Begruendung wie bei
// ist_produktion() in backend/db.php.
{
  const dash = lies('dashboard.html');
  const zeile = dash.match(/document\.title\s*=\s*([^\n;]+);/);
  check('KRITISCH: das Cockpit setzt den Reitername abhängig von der Umgebung — in der Demo einen eigenen, sonst den Namen der Anwendung',
    zeile !== null && /APP_UMGEBUNG_DEMO/.test(zeile[1]) && /APP_NAME/.test(zeile[1]));
  check('KRITISCH: der Demo-Reitername ist nicht der Name der Anwendung — "Cockpit" neben "Cockpit" verrät nicht, welches die Demo ist',
    zeile !== null && /demo/i.test(zeile[1].replace(/APP_UMGEBUNG_DEMO/g, '')));
  // Die Wasserzeichen benennen weiter die ANWENDUNG, nicht die Umgebung --
  // sonst hiesse die Seitenspalte in der Demo "Demobereich".
  check('KRITISCH: die Wasserzeichen im Tor und in der Seitenspalte tragen weiterhin den Namen der Anwendung',
    /\$\('gateWm'\)\.textContent = APP_NAME;/.test(dash)
    && /\$\('sideWm'\)\.textContent = APP_NAME;/.test(dash));
}

// ── 3. Jedes Buendel bringt die Icons mit, die seine Seiten verlangen ────
//
// DER EIGENTLICHE FALLSTRICK: Ein fehlender Verweis faellt beim Bauen auf,
// eine fehlende DATEI nicht -- lokal liegt sie ja im Verzeichnis. Auffallen
// wuerde es erst live, und ein Push geht sofort live.
const BUENDEL = [
  // [Schrittname, Zielverzeichnis, {Quellseite: Zieldatei}]
  ['Platzhalter durch echte Werte ersetzen', 'dist',
    { 'index.html': 'index.html', 'dashboard.html': 'dashboard.html', 'app.html': 'app.html',
      'portal.html': 'portal.html', 'betreiber.html': 'betreiber.html' }],
  ['Homepage-Buendel fuer guardops.ch bauen', 'dist-guardops',
    { 'homepage.html': 'index.html', 'impressum.html': 'impressum.html',
      'datenschutz.html': 'datenschutz.html' }],
  ['Betreiber-Buendel fuer betreiber.guardops.ch bauen', 'dist-betreiber',
    { 'betreiber.html': 'index.html' }],
  ['Portal-Buendel fuer portal.guardops.ch bauen', 'dist-portal',
    { 'portal.html': 'index.html' }],
  ['Rapport-Tool-Buendel fuer cupi24.guardops.ch bauen', 'dist-cupi24',
    { 'index.html': 'index.html', 'dashboard.html': 'dashboard.html', 'app.html': 'app.html',
      'portal.html': 'portal.html', 'betreiber.html': 'betreiber.html' }],
];

for (const [name, ziel, seiten] of BUENDEL) {
  const st = schritt(name);
  check(`KRITISCH: es gibt einen Schritt, der ${ziel}/ baut`, st !== '');
  if (st === '') { continue; }
  const zeilen = cpZeilen(st);

  // Die Ersetzungen, die dieses Buendel auf Icon-Pfade anwendet (heute nur
  // das CUPI-24-Branding, ENT-589). Aus dem Schritt GELESEN, nicht
  // abgeschrieben: Kommt morgen ein zweiter Mandant mit eigener Marke
  // dazu, prueft diese Suite ihn mit, ohne geaendert zu werden.
  const ersetzungen = sedErsetzungen(st);
  const umgehaengt = (pfad, zieldatei) => ersetzungen.reduce((p, e) =>
    e.dateien.includes(`${ziel}/${zieldatei}`) ? p.split(e.von).join(e.nach) : p, pfad);

  for (const [quelle, zieldatei] of Object.entries(seiten)) {
    check(`KRITISCH: ${ziel}/ liefert ${quelle} als ${zieldatei} aus`,
      zeilen.some(z => z.von === quelle && z.nach === `${ziel}/${zieldatei}`));
    for (const verweis of iconVerweise(lies(quelle))) {
      const echt = umgehaengt(verweis, zieldatei);
      check(`KRITISCH: ${echt} liegt im Bündel ${ziel}/ — ${quelle} verweist darauf, und eine fehlende Bilddatei fällt lokal NICHT auf`,
        wirdKopiert(zeilen, echt));
      check(`${echt} gibt es im Repository (von ${quelle} in ${ziel}/ verlangt)`,
        existsSync(`${WURZEL}/${echt}`));
    }
  }

  // Die geteilten Adressen duerfen das Siegel der Mandantin nicht einmal
  // MITBRINGEN: Was nicht im Buendel liegt, kann auch nicht versehentlich
  // verlinkt werden. dist/ und dist-cupi24/ sind ausgenommen -- dist/ ist
  // heute noch die Adresse des Bestandsmandanten (ENT-580 ist erst bei
  // Etappe drei), dist-cupi24/ ist sie ausdruecklich.
  if (!['dist', 'dist-cupi24'].includes(ziel)) {
    check(`KRITISCH: ${ziel}/ bringt kein Icon einer Mandantin mit — die Adresse gehört der Betreiberin (ENT-568)`,
      !zeilen.some(z => /icons\/(cupi24|icon)-/.test(z.von) || /icons\/\*/.test(z.von)));
  }
}

// ── 4. Das Branding der Mandantin bleibt auf ihrer eigenen Adresse ───────
//
// Die Umstellung des Favicons in dashboard.html (icons/icon-* ->
// icons/guardops-*) darf ENT-589 nicht ruecklings aufheben: Auf
// cupi24.guardops.ch soll weiterhin das CUPI-24-Siegel im Reiter stehen.
// Geprueft am ERGEBNIS der Ersetzung, nicht an ihrem Wortlaut.
{
  const st = schritt('Rapport-Tool-Buendel fuer cupi24.guardops.ch bauen');
  const dash = lies('dashboard.html');
  const sedZeilen = sedErsetzungen(st)
    .filter(e => e.dateien.includes('dist-cupi24/dashboard.html'));
  const nachher = sedZeilen.reduce((t, e) => t.split(e.von).join(e.nach), dash);
  const fav = faviconVerweise(nachher);
  check('KRITISCH: im cupi24-Bündel zeigt der Reiter des Cockpits das CUPI-24-Siegel (ENT-589) — die Umstellung auf die GuardOpS-Marke gilt nur für die geteilten Adressen',
    fav.length > 0 && fav.every(f => /^icons\/cupi24-/.test(f)));
  check('KRITISCH: das umgehängte Siegel liegt als Datei im Repository',
    fav.every(f => existsSync(`${WURZEL}/${f}`)));
}

// ── 5. GEMESSEN, NICHT NACHGELESEN ──────────────────────────────────────
//
// Der Reitername im Kopf der Datei ist NICHT der, den der Browser zeigt:
// dashboard.html setzt document.title beim Start selbst. Und ein
// <link rel="icon"> nuetzt nichts, wenn die Adresse daneben ins Leere
// zeigt. Beides ist nur am gerenderten Zustand zu sehen.
//
// Die Umgebung wird so gesetzt, wie der Deploy sie setzt: __APP_ENV__ in
// testumgebung.js ersetzt. Kein zweiter Mechanismus, der auseinanderlaufen
// koennte -- laeuft die Ersetzung im Deploy anders, misst diese Suite
// trotzdem den echten Weg.
{
  const browser = await chromium.launch({ executablePath: browserPfad() });
  const quelle = readFileSync(`${WURZEL}/testumgebung.js`, 'utf8');
  const adresse = d => pathToFileURL(join(WURZEL, d)).href;

  const gemessen = async (datei, umgebung) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const p = await ctx.newPage();
    p.on('pageerror', e => bad.push(`JS-Fehler (${datei}, ${umgebung}): ` + e.message));
    await p.route('**/testumgebung.js', r => r.fulfill({ status: 200,
      contentType: 'application/javascript',
      body: quelle.split('__APP_ENV__').join(umgebung) }));
    await p.route('**/api/**', r => r.fulfill({ status: 200,
      contentType: 'application/json', body: JSON.stringify({ status: 'ok' }) }));
    await p.goto(adresse(datei));
    await p.waitForTimeout(350);
    const werte = await p.evaluate(() => ({
      titel: document.title,
      favicons: [...document.querySelectorAll('link[rel="icon"]')].map(l => l.href),
      haus: [...document.querySelectorAll('link[rel="apple-touch-icon"]')].map(l => l.href),
    }));
    await ctx.close();
    return werte;
  };

  const alsPfad = (url) => decodeURIComponent(url.replace(/^file:\/\//, ''));

  for (const [datei, umgebung] of [['dashboard.html', 'production'], ['dashboard.html', 'demo'],
    ['portal.html', 'production'], ['betreiber.html', 'production'],
    ['app.html', 'production'], ['index.html', 'production']]) {
    const m = await gemessen(datei, umgebung);
    check(`KRITISCH: ${datei} (${umgebung}) zeigt im Reiter ein Favicon, und die verlinkte Datei ist wirklich da`,
      m.favicons.length > 0 && m.favicons.every(u => existsSync(alsPfad(u))));
    check(`${datei} (${umgebung}) verlinkt ein Haus-Symbol, und die Datei ist wirklich da`,
      m.haus.length > 0 && m.haus.every(u => existsSync(alsPfad(u))));
    check(`${datei} (${umgebung}) trägt am Ende des Ladens einen Reitername`, m.titel.trim().length >= 3);
  }

  // Der Befund aus Lauf 525, am gerenderten Zustand: Demo und Produktion
  // duerfen im Reiter nicht dasselbe Wort zeigen.
  const prod = await gemessen('dashboard.html', 'production');
  const demo = await gemessen('dashboard.html', 'demo');
  check('KRITISCH: das Cockpit heisst in der Demo im Reiter anders als in der Produktion — GEMESSEN am gerenderten document.title',
    prod.titel !== demo.titel && /demo/i.test(demo.titel));
  check('KRITISCH: der Reitername der Produktion bleibt der Name der Anwendung',
    prod.titel === 'Cockpit');
  await browser.close();
}

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
