// Der Reiter Vorrat (ENT-705), GEMESSEN am gerenderten Zustand und im
// Browser DURCHGESPIELT.
//
// Was hier zaehlt:
//   - Vorratsplaetze stehen im eigenen Reiter, nicht unter den Kunden.
//   - Der Punkt am Reiter faerbt sich genau dann, wenn zu wenige bereit
//     sind -- und bleibt aus, wenn der Stand unbekannt ist (unbekannt ist
//     nicht "zu wenig").
//   - Ein nicht bereiter Platz hat keinen anklickbaren Zuteilen-Knopf, und
//     der ausgegraute nennt den Grund.
//   - Zuteilen, Anlegen und Entfernen schicken, was sie sollen, an den
//     richtigen Endpunkt.
//
// Nur am Desktop: Der Betreiber-Bereich hat keine Handy-Fassung (ENT-701).
// Die Serverantworten werden abgefangen; es laeuft der Code der Seite.
import { chromium } from 'playwright';
import { WURZEL, browserPfad } from './pfade.mjs';
import { readFileSync } from 'fs';
import { join } from 'path';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const SEITE = readFileSync(join(WURZEL, 'betreiber.html'), 'utf8');
const BASIS = 'http://pruef.invalid/';

// Erfundene Werte (CLAUDE.md, Vertraulichkeit).
const LISTE = { status: 'ok', mandanten: [
  { id: 1, name: 'Beispielwache AG', subdomain: 'beispielwache', kanton: 'BE', status: 'aktiv',
    ist_demo: false, uebergabe: { lage: 'keine', datum: null } },
  { id: 4, name: 'Vorrat 1', subdomain: '', status: 'vorrat', ist_demo: false,
    db_host: 'db.beispiel.invalid', db_name: 'vorrat1', db_user: 'vorrat1', secret_name: 'DB_PASS_VORRAT_1' },
  { id: 5, name: 'Vorrat 2', subdomain: '', status: 'vorrat', ist_demo: false,
    db_host: 'db.beispiel.invalid', db_name: 'vorrat2', db_user: 'vorrat2', secret_name: 'DB_PASS_VORRAT_2' },
  { id: 9, name: 'demo1', subdomain: 'demo1', status: 'aktiv', ist_demo: true },
] };
const ZU_WENIG = { status: 'ok', eingetragen: 2, bereit: 1, soll: 3, schwelle: 2, zu_wenig: true, plaetze: [
  { id: 4, name: 'Vorrat 1', lage: 'bereit', bereit: true, text: 'übergabefähig' },
  { id: 5, name: 'Vorrat 2', lage: 'secret_fehlt', bereit: false,
    text: 'Zugangsdaten fehlen im Deploy (MANDANT_SECRETS)' },
] };

async function aufbauen(page, antworten, protokoll) {
  await page.route(BASIS + '**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/betreiber.html') {
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: SEITE });
    }
    const name = url.pathname.replace(/^\/api\//, '');
    protokoll.push({ name, methode: route.request().method(), body: route.request().postData() || '' });
    const a = antworten[name] || { status: 'error', message: 'in dieser Pruefung nicht vorgesehen' };
    const code = a.__code || 200;
    const { __code, ...rest } = a;
    return route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(rest) });
  });
}
async function bis(bedingung) {
  for (let i = 0; i < 50 && !(await bedingung()); i++) { await new Promise(r => setTimeout(r, 100)); }
}
async function oeffnen(page) {
  await page.goto(BASIS + 'betreiber.html');
  await page.evaluate(async () => {
    document.getElementById('tor').classList.add('versteckt');
    document.getElementById('haus').classList.remove('versteckt');
    document.getElementById('b-mandanten').classList.remove('versteckt');
    await ladeMandanten();
  });
}
const vorratGeladen = page => page.waitForFunction(() =>
  document.getElementById('vorrat-inhalt').innerHTML !== '');

const browser = await chromium.launch({ executablePath: browserPfad() });

// ── 1. Zu wenig bereit: Punkt, Kennzahlen, Tabelle, Bereiche ───────────
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const protokoll = [];
  await aufbauen(page, {
    'betreiber_mandant_list.php': LISTE,
    'betreiber_vorrat_pruefen.php': ZU_WENIG,
    'betreiber_vorrat_zuteilen.php': { status: 'ok', id: 4, name: 'Musterschutz GmbH' },
    'betreiber_mandant_save.php': { status: 'ok', id: 6, angelegt: true },
    'betreiber_vorrat_entfernen.php': { status: 'ok', id: 5 },
  }, protokoll);
  await oeffnen(page);
  await page.waitForSelector('#m-inhalt table');
  await vorratGeladen(page);

  // Die Kunden: nur der Kunde, Demo und Vorrat stehen im Hinweis.
  const kunden = await page.evaluate(() => ({
    namen: [...document.querySelectorAll('#m-inhalt tr.auf-kopf strong')].map(s => s.textContent),
    hinweis: (document.querySelector('#m-inhalt .hinweis') || {}).textContent || '',
  }));
  check('KRITISCH: unter Mandanten stehen nur Kunden, kein Vorratsplatz',
    kunden.namen.join('|') === 'Beispielwache AG');
  check('der Hinweis nennt Demo und Vorrat je fuer sich, mit Zahl',
    /1 Demo-Platz steht im Reiter Demo/.test(kunden.hinweis) && /2 Vorratsplätze stehen im Reiter Vorrat/.test(kunden.hinweis));

  // Der Punkt am Reiter, still geladen -- ohne dass jemand den Reiter oeffnet.
  const punkt = await page.evaluate(() => {
    const p = document.getElementById('vorratPunkt');
    const oben = [...document.querySelectorAll('#topSub button')].find(b => b.textContent.startsWith('Vorrat'));
    const op = oben && oben.querySelector('.tab-punkt');
    const r = op ? op.getBoundingClientRect() : null;
    const tr = oben ? oben.getBoundingClientRect() : null;
    return { verborgen: p.hidden, oben: !!op, breite: r ? r.width : 0,
             imKnopf: r && tr ? r.left >= tr.left && r.right <= tr.right && r.top >= tr.top && r.bottom <= tr.bottom : false,
             farbe: op ? getComputedStyle(op).backgroundColor : '' };
  });
  check('KRITISCH: zu wenig bereit -> der Reiter Vorrat traegt den Punkt', !punkt.verborgen);
  check('KRITISCH: auch in der oberen Reiterleiste (Desktop ab 1211 px), sichtbar und im Knopf',
    punkt.oben && punkt.breite >= 6 && punkt.imKnopf);
  check('der Punkt ist gefaerbt, nicht durchsichtig', punkt.farbe && punkt.farbe !== 'rgba(0, 0, 0, 0)');

  await page.evaluate(() => mandGo('vorrat'));
  // Kennzahlen: Ueberschrift oben, Wert darunter; Bezug steht dabei.
  const zahlen = await page.evaluate(() => [...document.querySelectorAll('#vorrat-zahlen .zahl')].map(z => {
    const lab = z.querySelector('.lab'), wert = z.querySelector('.wert');
    return { lab: lab.textContent, wert: wert.textContent, bezug: (z.querySelector('.bezug') || {}).textContent || '',
             obenUnten: lab.getBoundingClientRect().bottom <= wert.getBoundingClientRect().top + 1 };
  }));
  check('Kennzahlen: Bereit und Soll, in dieser Reihenfolge',
    zahlen.map(z => z.lab).join('|') === 'Bereit|Soll');
  check('KRITISCH: "Bereit" hat seinen Bezug -- 1 von 2 eingetragenen',
    zahlen[0].wert === '1' && /1 von 2 eingetragenen/.test(zahlen[0].bezug));
  check('"Soll" nennt die Schwelle, an der gemeldet wird', zahlen[1].wert === '3' && /unter 2/.test(zahlen[1].bezug));
  check('gemessen: Ueberschrift oben, Wert darunter', zahlen.every(z => z.obenUnten));

  // Tabelle zugeklappt: kein Handlungsknopf, nur Pfeile.
  const tabelle = await page.evaluate(() => ({
    zeilen: [...document.querySelectorAll('#vorrat-inhalt tr.auf-kopf strong')].map(s => s.textContent),
    knoepfe: [...document.querySelectorAll('#vorrat-inhalt button')]
      .filter(b => b.offsetParent !== null && !b.classList.contains('auf-knopf')).length,
    stand: [...document.querySelectorAll('#vorrat-inhalt tr.auf-kopf td:nth-child(3)')].map(t => t.innerText),
    db: (document.querySelector('#vorrat-inhalt tr.auf-kopf td:nth-child(2)') || {}).innerText || '',
  }));
  check('beide Plaetze stehen in der Tabelle', tabelle.zeilen.join('|') === 'Vorrat 1|Vorrat 2');
  check('KRITISCH: zugeklappt steht kein Handlungsknopf in der Tabelle', tabelle.knoepfe === 0);
  check('der Stand nennt beim nicht bereiten Platz den Grund',
    /bereit/.test(tabelle.stand[0]) && /Secret fehlt/.test(tabelle.stand[1]) && /MANDANT_SECRETS/.test(tabelle.stand[1]));
  check('die Datenbank steht mit Host und Secret-Name', /vorrat1 @ db\.beispiel\.invalid/.test(tabelle.db) && /DB_PASS_VORRAT_1/.test(tabelle.db));

  // Der nicht bereite Platz: Zuteilen ausgegraut, mit Grund.
  await page.click('#vorrat-inhalt tr.auf-kopf >> nth=1 >> td >> nth=0');
  const b2 = await page.evaluate(() => {
    const leib = [...document.querySelectorAll('#vorrat-inhalt tr.auf-leib')].find(l => !l.classList.contains('versteckt'));
    const bereiche = [...leib.querySelectorAll('.auf-bereich')];
    const zut = [...leib.querySelectorAll('button')].find(b => /zuteilen/.test(b.textContent));
    return { titel: bereiche.map(b => b.querySelector('.auf-titel').textContent),
             gefahr: bereiche.map(b => b.classList.contains('gefahr')),
             zuteilenAus: zut ? zut.disabled : null, grund: zut ? zut.title : '' };
  });
  check('aufgeklappt: Datenbank, Zuteilen, Entfernen', b2.titel.join('|') === 'Datenbank|Zuteilen|Entfernen');
  check('KRITISCH: Entfernen steht zuletzt und als einziger abgesetzt',
    b2.gefahr.join('|') === 'false|false|true');
  check('KRITISCH: nicht bereit -> der Zuteilen-Knopf ist ausgegraut und nennt den Grund',
    b2.zuteilenAus === true && /Secret|MANDANT_SECRETS/.test(b2.grund));

  // Der bereite Platz: Zuteilen durchspielen.
  await page.click('#vorrat-inhalt tr.auf-kopf >> nth=0 >> td >> nth=0');
  await page.click('[data-vorrat-zuteilen="4"]');
  await page.waitForFunction(() => document.getElementById('dlgZuteilen').classList.contains('on'));
  await page.click('#tSaveBtn');
  const leer = await page.evaluate(() => document.getElementById('tErr').textContent);
  check('ohne Namen wird gemeldet, ohne den Server zu fragen',
    /Name/.test(leer) && !protokoll.some(p => p.name === 'betreiber_vorrat_zuteilen.php'));
  await page.fill('#t_name', 'Musterschutz GmbH');
  await page.fill('#t_kanton', 'zh');
  await page.fill('#t_subdomain', 'MusterSchutz');
  await page.fill('#t_mindest', '12');
  await page.click('#tSaveBtn');
  await bis(() => protokoll.some(p => p.name === 'betreiber_vorrat_zuteilen.php'));
  const zug = protokoll.find(p => p.name === 'betreiber_vorrat_zuteilen.php');
  const zDaten = zug ? JSON.parse(zug.body) : {};
  check('KRITISCH: zugeteilt wird ueber den eigenen Endpunkt, per POST, mit der Platznummer',
    zug && zug.methode === 'POST' && zDaten.id === 4 && zDaten.name === 'Musterschutz GmbH');
  check('die Subdomain geht klein geschrieben hinaus', zDaten.subdomain === 'musterschutz');
  check('Vertragsangaben gehen mit, leere als leer (nicht 0)',
    zDaten.mindestlaufzeit_monate === '12' && zDaten.kuendigungsfrist_monate === '');
  await page.waitForFunction(() => document.getElementById('mtab-mandanten').classList.contains('on'));
  check('nach dem Zuteilen steht man bei den Mandanten, wo die Einladung ausgestellt wird',
    await page.evaluate(() => !document.getElementById('dlgZuteilen').classList.contains('on')
      && document.getElementById('mv-mandanten').classList.contains('on')));

  // Anlegen: vier Felder, der Name kommt vom Server.
  await page.evaluate(() => mandGo('vorrat'));
  await page.click('#knopf-vorrat-neu');
  await page.waitForFunction(() => document.getElementById('dlgVorrat').classList.contains('on'));
  await page.fill('#v_host', 'db.beispiel.invalid');
  await page.fill('#v_db', 'vorrat3');
  await page.fill('#v_user', 'vorrat3');
  await page.click('#vSaveBtn');
  const halb = await page.evaluate(() => document.getElementById('vErr').textContent);
  check('fehlt eine Angabe, wird gemeldet, ohne den Server zu fragen',
    /vier Angaben/.test(halb) && !protokoll.some(p => p.name === 'betreiber_mandant_save.php'));
  await page.fill('#v_secret', 'DB_PASS_VORRAT_3');
  await page.click('#vSaveBtn');
  await bis(() => protokoll.some(p => p.name === 'betreiber_mandant_save.php'));
  const an = protokoll.find(p => p.name === 'betreiber_mandant_save.php');
  const aDaten = an ? JSON.parse(an.body) : {};
  check('KRITISCH: angelegt wird als Vorrat, ohne Namen und ohne Id -- den Namen vergibt der Server',
    aDaten.vorrat === true && !('name' in aDaten) && !('id' in aDaten)
    && aDaten.db_name === 'vorrat3' && aDaten.secret_name === 'DB_PASS_VORRAT_3');
  check('KRITISCH: kein Passwortfeld geht hinaus',
    !Object.keys(aDaten).some(k => /pass|secret$/.test(k) && k !== 'secret_name'));

  // Entfernen: Rueckfrage nennt, was bleibt; erst danach geht es hinaus.
  await vorratGeladen(page);
  await page.click('#vorrat-inhalt tr.auf-kopf >> nth=1 >> td >> nth=0');
  await page.click('[data-vorrat-entfernen="5"]');
  await page.waitForFunction(() => document.getElementById('dlgFrage').classList.contains('on'));
  const frage = await page.evaluate(() => ({ titel: document.getElementById('frageTitel').textContent,
    text: document.getElementById('frageText').textContent, knopf: document.getElementById('frageJa').textContent }));
  check('die Rueckfrage nennt den Platz und sagt, dass Datenbank und Secret bleiben',
    /Vorrat 2/.test(frage.titel) && /Datenbank beim Hoster/.test(frage.text) && /MANDANT_SECRETS/.test(frage.text)
    && frage.knopf === 'Entfernen');
  check('KRITISCH: vor der Bestaetigung wird nichts entfernt',
    !protokoll.some(p => p.name === 'betreiber_vorrat_entfernen.php'));
  await page.click('#frageJa');
  await bis(() => protokoll.some(p => p.name === 'betreiber_vorrat_entfernen.php'));
  const ent = protokoll.find(p => p.name === 'betreiber_vorrat_entfernen.php');
  check('KRITISCH: entfernt wird ueber den eigenen Endpunkt, per POST, mit der Platznummer',
    ent && ent.methode === 'POST' && JSON.parse(ent.body).id === 5);
  await page.close();
}

// ── 2. Genug bereit, nicht eingerichtet, leer ─────────────────────────
for (const [fall, antwort, erwartet] of [
  ['genug bereit', { ...ZU_WENIG, bereit: 2, zu_wenig: false,
      plaetze: ZU_WENIG.plaetze.map(p => ({ ...p, lage: 'bereit', bereit: true, text: 'übergabefähig' })) },
    { punkt: false, text: null, knopfAus: false }],
  ['nicht eingerichtet', { __code: 503, status: 'error',
      message: 'Der Vorrat ist in dieser Anlage noch nicht nachgetragen. Ein Lauf der Einrichtung holt das nach.' },
    { punkt: false, text: /Noch nicht eingerichtet/, knopfAus: true }],
  ['nicht abrufbar', { status: 'error', message: 'Datenbank nicht erreichbar' },
    { punkt: false, text: /Stand nicht abrufbar/, knopfAus: false }],
  ['nichts eingetragen', { status: 'ok', eingetragen: 0, bereit: 0, soll: 3, schwelle: 2, zu_wenig: true, plaetze: [] },
    { punkt: true, text: /Noch kein Vorratsplatz eingetragen/, knopfAus: false }],
]) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await aufbauen(page, { 'betreiber_mandant_list.php': LISTE, 'betreiber_vorrat_pruefen.php': antwort }, []);
  await oeffnen(page);
  await vorratGeladen(page);
  const st = await page.evaluate(() => ({
    punkt: !document.getElementById('vorratPunkt').hidden,
    inhalt: document.getElementById('vorrat-inhalt').innerText,
    zahlen: document.getElementById('vorrat-zahlen').innerText,
    knopfAus: document.getElementById('knopf-vorrat-neu').disabled,
  }));
  check(`${fall}: der Punkt ist ${erwartet.punkt ? 'an' : 'aus'}`, st.punkt === erwartet.punkt);
  if (erwartet.text) { check(`${fall}: eigener Text statt einer leeren Tabelle`, erwartet.text.test(st.inhalt)); }
  check(`${fall}: der Anlegen-Knopf ist ${erwartet.knopfAus ? 'gesperrt' : 'frei'}`, st.knopfAus === erwartet.knopfAus);
  if (antwort.status !== 'ok') {
    check(`KRITISCH: ${fall}: keine Kennzahl, die wie "0 bereit" aussieht`, st.zahlen.trim() === '');
  }
  await page.close();
}

await browser.close();

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
