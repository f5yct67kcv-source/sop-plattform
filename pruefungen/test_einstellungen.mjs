// Einstellungsseite (ENT-722).
//
// Hell/dunkel und Glas gehoeren seither dem KONTO, nicht mehr dem Browser,
// und stehen auf einer eigenen Seite statt in der Kopfleiste. Zwei Haelften:
//
//  A) Der Endpunkt meine_einstellungen.php wird WIRKLICH AUSGEFUEHRT
//     (pruef_meine_einstellungen.php, SQLite im Arbeitsspeicher). Er
//     verlangt kein Recht, nur eine Sitzung -- ob er wirklich nur am
//     eigenen Konto und nur mit der weissen Liste schreibt, ist eine Aussage
//     ueber die Datenbank nach dem Aufruf, nicht ueber den Wortlaut.
//
//  B) Die Oberflaeche wird GEMESSEN: was wann ans Konto geht, was vom Konto
//     uebernommen wird, welche Reiter wer sieht, und ob die vier Lagen
//     (laedt, am Konto, nur Browser, Fehler) vier verschiedene Saetze haben.
//
// KEIN festes Datum in dieser Datei (test_datumsfest.mjs).
import { WURZEL, HIER, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { execFileSync } from 'child_process';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

function aufruf(methode, lage, koerper) {
  const roh = execFileSync('php', [`${HIER}/pruef_meine_einstellungen.php`, methode, lage],
    { input: koerper === undefined ? '' : JSON.stringify(koerper), encoding: 'utf8' });
  return JSON.parse(roh);
}
const json = t => (t === null || t === false || t === undefined) ? t : JSON.parse(t);

// ══════════════════════════════════════════ A) DER ENDPUNKT, AUSGEFUEHRT
try {
  const a = aufruf('GET', 'leer');
  check('Ohne Gespeichertes antwortet der Endpunkt mit null -- nicht mit einem leeren Objekt',
    a.status === 'ok' && a.einstellungen === null && !a.stand_unbekannt);

  const b = aufruf('POST', 'leer', { einstellungen: { thema: 'dunkel', glas: 'an' } });
  check('Eine gueltige Wahl wird am eigenen Konto gespeichert',
    b.status === 'ok' && JSON.stringify(json(b.pruefung.ich)) === JSON.stringify({ thema: 'dunkel', glas: 'an' }));
  check('KRITISCH: am fremden Konto bleibt nichts haengen', b.pruefung.andere === null);

  // Der Rumpf traegt ABSICHTLICH die Kennung der anderen Person -- so saehe
  // der Versuch aus, ueber diesen Endpunkt ein fremdes Konto zu erreichen.
  const c = aufruf('POST', 'vorbelegt', { id: 2, mitarbeiter_id: 2,
    einstellungen: { glas: 'an', thema: 'lila', id: 2, skript: '<b>x</b>' } });
  const ich = json(c.pruefung.ich);
  check('KRITISCH: die mitgeschickte fremde Kennung erreicht das fremde Konto nicht',
    JSON.stringify(json(c.pruefung.andere)) === JSON.stringify({ thema: 'hell', glas: 'an' }));
  check('KRITISCH: nur Schluessel und Werte der weissen Liste kommen durch',
    JSON.stringify(Object.keys(ich).sort()) === JSON.stringify(['glas', 'thema']) && !('skript' in ich));
  check('Ein unbekannter Wert ueberschreibt den gespeicherten nicht', ich.thema === 'dunkel');
  check('Zusammengefuehrt, nicht ersetzt: die neue Glas-Wahl gilt, das Thema bleibt',
    ich.glas === 'an' && ich.thema === 'dunkel');

  const d = aufruf('POST', 'vorbelegt', { einstellungen: { farbe: 'rot' } });
  check('Ohne eine einzige gueltige Wahl gibt es einen Fehler statt eines stillen Erfolgs',
    d.status === 'error' && d.pruefung.http === 400);
  check('und das Gespeicherte bleibt unangetastet',
    JSON.stringify(json(d.pruefung.ich)) === JSON.stringify({ thema: 'dunkel', glas: 'aus' }));

  // Benachrichtigungen: die schaltbaren Arten kommen durch, Vorfall und
  // Supportantwort nicht -- sie sind immer an, auch wenn ein Browser
  // etwas anderes schickt.
  const g = aufruf('POST', 'leer', { einstellungen: { glocke_rapport: 'aus', glocke_zusage: 'an',
    glocke_vorfall: 'aus', glocke_support_antwort: 'aus', glocke_sperrtag: 'vielleicht' } });
  check('Glocke: eine ausgeschaltete Art wird gespeichert',
    JSON.stringify(json(g.pruefung.ich)) === JSON.stringify({ glocke_rapport: 'aus', glocke_zusage: 'an' }));
  check('KRITISCH Glocke: Vorfall und Supportantwort lassen sich nicht ausschalten, auch nicht am Browser vorbei',
    !('glocke_vorfall' in json(g.pruefung.ich)) && !('glocke_support_antwort' in json(g.pruefung.ich)));
  const liste = JSON.parse(execFileSync('php', ['-r',
    `require '${WURZEL}/backend/ereignisse.php'; echo json_encode(GLOCKE_SCHALTBAR);`], { encoding: 'utf8' }));
  const alle = aufruf('POST', 'leer', { einstellungen: Object.fromEntries(
    ['rapport', 'sperrtag', 'zusage', 'offerte', 'rundgang_spontan', 'vorfall', 'support_antwort', 'abwesenheit']
      .map(a => ['glocke_' + a, 'aus'])) });
  check('KRITISCH Glocke: die weisse Liste kennt genau die Arten, die der Server wegfiltern darf',
    JSON.stringify(Object.keys(json(alle.pruefung.ich)).map(k => k.replace('glocke_', '')).sort())
      === JSON.stringify([...liste].sort()));

  const e = aufruf('GET', 'ohne_spalte');
  check('KRITISCH: fehlt die Spalte, sagt der Endpunkt "unbekannt" -- nicht "nichts gespeichert"',
    e.status === 'ok' && e.stand_unbekannt === true);
  const f = aufruf('POST', 'ohne_spalte', { einstellungen: { thema: 'hell' } });
  check('Ohne Spalte wird nicht so getan, als waere gespeichert worden',
    f.status === 'error' && f.pruefung.http === 409 && f.stand_unbekannt === true);
} catch (x) { check('Abschnitt Endpunkt ohne Abbruch: ' + x.message, false); }

// Dasselbe gegen den Betreiber-Endpunkt (Tabelle betreiber, ENT-722).
try {
  const aufrufB = (m, l, k) => JSON.parse(execFileSync('php',
    [`${HIER}/pruef_meine_einstellungen.php`, m, l, 'betreiber'],
    { input: k === undefined ? '' : JSON.stringify(k), encoding: 'utf8' }));
  check('Betreiber: ohne Gespeichertes null', aufrufB('GET', 'leer').einstellungen === null);
  const b = aufrufB('POST', 'vorbelegt', { id: 2, einstellungen: { glas: 'an', app_thema: 'hell', dichte: 'kompakt' } });
  check('KRITISCH Betreiber: das fremde Konto bleibt unberuehrt',
    JSON.stringify(json(b.pruefung.andere)) === JSON.stringify({ thema: 'hell', glas: 'an' }));
  check('KRITISCH Betreiber: nur thema und glas -- Schluessel des Cockpits und der App fallen weg',
    JSON.stringify(json(b.pruefung.ich)) === JSON.stringify({ thema: 'dunkel', glas: 'an' }));
  check('Betreiber: ohne Spalte "unbekannt"', aufrufB('GET', 'ohne_spalte').stand_unbekannt === true);
} catch (x) { check('Abschnitt Betreiber-Endpunkt ohne Abbruch: ' + x.message, false); }

// ══════════════════════════════════════════ B) DIE OBERFLAECHE
// konto: was der Endpunkt beim Laden antwortet -- null (nichts gespeichert),
// ein Objekt, 'unbekannt' (Spalte fehlt) oder 'stumm' (Antwort ohne Feld).
async function starte({ breite = 1440, thema = 'dunkel', glas = 'an', konto = null, rechte } = {}) {
  const browser = await chromium.launch({ executablePath: browserPfad() });
  const page = await browser.newPage({ viewport: { width: breite, height: 900 } });
  const fehler = [], posts = [];
  page.on('pageerror', e => fehler.push(e.message));
  await page.addInitScript(([t, g]) => {
    try { localStorage.setItem('rv3_thema', t); localStorage.setItem('rv3_glas', g);
          localStorage.setItem('rv3_huelle', 'aus'); } catch (e) {}
  }, [thema, glas]);
  const rr = rechte || ['betrieb_lesen', 'planung_lesen', 'kunden_lesen'];
  await page.route('**/api/**', route => {
    const u = route.request().url();
    const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.includes('login')) return send({ status: 'ok', token: 't', name: 'muster.person', ist_admin: false, rechte: rr, rollen: ['planung'] });
    if (u.includes('me.php')) return send({ status: 'ok', name: 'muster.person', ist_admin: false, rechte: rr, rollen: ['planung'] });
    if (u.includes('meine_einstellungen')) {
      if (route.request().method() === 'POST') {
        posts.push(JSON.parse(route.request().postData()).einstellungen);
        if (konto === 'unbekannt') return route.fulfill({ status: 409, contentType: 'application/json',
          body: JSON.stringify({ status: 'error', stand_unbekannt: true }) });
        return send({ status: 'ok', einstellungen: {} });
      }
      if (konto === 'unbekannt') return send({ status: 'ok', einstellungen: null, stand_unbekannt: true });
      if (konto === 'stumm') return send({ status: 'ok' });
      return send({ status: 'ok', einstellungen: konto });
    }
    if (u.includes('dashboard_stats')) return send({ status: 'ok', kpi: { rapporte_monat: 0, rapporte_vormonat: 0,
      stunden_monat: 0, stunden_vormonat: 0, mitarbeiter: 0, kunden: 0, rapporte_total: 0 },
      verlauf: [], angemeldet: [], letzte_rapporte: [], ereignisse: [], ereignisse_unvollstaendig: [], pro_mitarbeiter: [] });
    return send({ status: 'ok', kunden: [], rapporte: [], feiertage: [], gepflegt: {}, sperren: [], einsaetze: [], mitarbeiter: [] });
  });
  await page.goto(`file://${WURZEL}/dashboard.html`);
  await page.fill('#gName', 'a'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
  await page.waitForSelector('#shell.on'); await page.waitForTimeout(500);
  return { browser, page, fehler, posts };
}
const attr = (page, a) => page.evaluate(n => document.documentElement.getAttribute(n), a);
const standText = page => page.evaluate(() => $('esStand').textContent.trim());

// Ein "vollstaendiges" Konto traegt auch 'dichte': Wo es die kompakte
// Darstellung gibt (Branch test), wuerde ein fehlender Schluessel sonst
// richtigerweise einmal aus dem Browser uebernommen.
// ── 1) Weg dorthin, Kopfleiste, Aufbau ─────────────────────────────────────
{
  const { browser, page, fehler, posts } = await starte({ konto: { thema: 'dunkel', glas: 'an', dichte: 'normal' } });
  check('KRITISCH: in der Werkzeugleiste steht kein Thema- oder Glas-Schalter mehr',
    await page.evaluate(() => !document.querySelector('.tb-rechts .thema-schalter, .tb-rechts .glas-schalter')));
  await page.click('#btnMarke'); await page.waitForTimeout(250);
  check('Im Kontomenue steht "Einstellungen"', await page.isVisible('#nav-einstellungen'));
  const reihe = await page.evaluate(() => {
    const e = $('nav-einstellungen').getBoundingClientRect(), h = $('nav-handbuch').getBoundingClientRect();
    const u = document.querySelector('.side-foot .side-user').getBoundingClientRect();
    return { unterNutzer: e.top >= u.bottom - 1, ueberHandbuch: e.bottom <= h.top + 1 };
  });
  check('Er steht unter dem Benutzerblock und ueber dem Handbuch', reihe.unterNutzer && reihe.ueberHandbuch);
  check('Er traegt ein anderes Zeichen als "Einrichtung" (zwei Zahnraeder waeren nicht zu unterscheiden)',
    await page.evaluate(() => $('nav-einstellungen').querySelector('svg').innerHTML
      !== $('nav-einrichtung').querySelector('svg').innerHTML));
  await page.click('#nav-einstellungen'); await page.waitForTimeout(300);
  check('Ein Klick oeffnet die Seite', await page.isVisible('#view-einstellungen'));
  check('Das Kontomenue schliesst dabei', await page.evaluate(() => !$('shell').classList.contains('menue-offen')));
  check('Die Kopfzeile sagt, wo man ist', (await page.textContent('#pgTitle')).trim() === 'Einstellungen');
  check('Geoeffnet wird immer "Darstellung"',
    await page.evaluate(() => document.querySelector('.es-nav-knopf.aktiv').dataset.reiter === 'darstellung'));
  check('Darin die beiden Schalter', await page.isVisible('#btnThema') && await page.isVisible('#btnGlas'));

  // Gemessen: nichts ragt aus der linken Spalte, und die Schalter stehen
  // rechts in ihrer Zeile auf einer Linie.
  const mass = await page.evaluate(() => {
    const nav = document.querySelector('.es-nav').getBoundingClientRect();
    const raus = [...document.querySelectorAll('.es-nav-knopf')].filter(k => {
      const r = k.getBoundingClientRect();
      return r.right > nav.right + 0.5 || [...k.children].some(c => c.getBoundingClientRect().right > r.right + 0.5);
    }).map(k => k.dataset.reiter);
    const zweizeilig = [...document.querySelectorAll('.es-nav-lbl')].filter(l => l.getBoundingClientRect().height > 22)
      .map(l => l.textContent);
    const karte = document.querySelector('.es-teil[data-reiter="darstellung"] .card-bd').getBoundingClientRect();
    const t = $('btnThema').getBoundingClientRect(), g = $('btnGlas').getBoundingClientRect();
    const knopfH = Math.min(...[...document.querySelectorAll('.es-nav-knopf')].map(k => k.getBoundingClientRect().height));
    return { raus, zweizeilig, rechtsBuendig: Math.abs(t.right - g.right) <= 1,
             amRand: karte.right - t.right, knopfH };
  });
  check(`Nichts ragt aus der linken Spalte (${mass.raus.join(', ') || 'ok'})`, mass.raus.length === 0);
  check(`Keine Reiterbeschriftung bricht um (${mass.zweizeilig.join(', ') || 'ok'})`, mass.zweizeilig.length === 0);
  check('Die Schalter stehen auf einer senkrechten Linie', mass.rechtsBuendig);
  check('und am rechten Rand ihrer Karte, nicht irgendwo in der Mitte', mass.amRand <= 24);
  check('Die Reiter sind gut zu treffen (mindestens 40 px hoch)', mass.knopfH >= 40);

  // Platzhalter: klickbar, mit einem eigenen Satz -- "in Arbeit" darf
  // nicht aussehen wie "hier gibt es nichts".
  const platz = {};
  for (const r of ['farben', 'maildesigner', 'system']) {
    await page.click(`.es-nav-knopf[data-reiter="${r}"]`); await page.waitForTimeout(80);
    platz[r] = await page.evaluate(k => {
      const t = document.querySelector(`.es-teil[data-reiter="${k}"]`);
      return { sichtbar: !t.hidden && !!t.offsetParent, text: t.querySelector('.es-platz').textContent.trim(),
               darstellungWeg: document.querySelector('.es-teil[data-reiter="darstellung"]').hidden };
    }, r);
  }
  check('Jeder Reiter in Arbeit laesst sich oeffnen und verdraengt die Darstellung',
    Object.values(platz).every(p => p.sichtbar && p.darstellungWeg));
  check('KRITISCH: jeder sagt, dass er in Arbeit ist',
    Object.values(platz).every(p => /in arbeit/i.test(p.text)));
  check('Und jeder sagt, WAS dort entsteht -- drei verschiedene Saetze',
    new Set(Object.values(platz).map(p => p.text)).size === 3);
  check('Der E-Mail-Designer sagt, dass er fuer den ganzen Betrieb gilt',
    /betrieb/i.test(platz.maildesigner.text));
  check('Die Reiter in Arbeit tragen den Hinweis auch in der linken Spalte',
    await page.evaluate(() => [...document.querySelectorAll('.es-nav-knopf')]
      .every(k => ['darstellung', 'benachrichtigungen'].includes(k.dataset.reiter) === !k.querySelector('.es-inarbeit'))));
  await page.screenshot({ path: `${OUT}/einstellungen-desktop.png` });
  check('Auf einer gespeicherten Wahl wird beim Oeffnen nichts hochgeladen', posts.length === 0);
  check('Keine JavaScript-Fehler', fehler.length === 0);
  await browser.close();
}

// ── 2) Wer sieht "Fuer den Betrieb" ────────────────────────────────────────
{
  const { browser, page } = await starte({ konto: { thema: 'dunkel' }, rechte: ['planung_lesen'] });
  await page.evaluate(() => go('einstellungen')); await page.waitForTimeout(200);
  check('Ohne das Recht "betrieb" fehlt die Gruppe "Fuer den Betrieb"',
    await page.evaluate(() => !$('esBetriebNav').offsetParent));
  check('"Fuer mich" bleibt da', await page.isVisible('.es-nav-knopf[data-reiter="farben"]'));
  await page.evaluate(() => esReiterZeigen('maildesigner')); await page.waitForTimeout(80);
  check('Auch ein Aufruf am Menue vorbei oeffnet den Betriebsreiter nicht',
    await page.evaluate(() => document.querySelector('.es-teil[data-reiter="maildesigner"]').hidden
      && !document.querySelector('.es-teil[data-reiter="darstellung"]').hidden));
  await browser.close();
}

// ── 3) Einmal uebernehmen ──────────────────────────────────────────────────
{
  const { browser, page, posts } = await starte({ thema: 'hell', glas: 'aus', konto: null });
  await page.waitForTimeout(300);
  check('KRITISCH: hat das Konto noch nichts, uebernimmt es einmal, was der Browser wusste',
    posts.length === 1 && posts[0].thema === 'hell' && posts[0].glas === 'aus');
  check('Die Oberflaeche bleibt dabei, wie sie war',
    await attr(page, 'data-thema') === 'hell' && await attr(page, 'data-glas') === 'aus');
  await page.evaluate(() => go('einstellungen')); await page.waitForTimeout(200);
  const amKonto = await standText(page);
  check('Die Seite sagt, dass die Wahl am Konto steht', /konto/i.test(amKonto) && /jedem gerät/i.test(amKonto));

  // Umschalten auf der Seite geht ans Konto -- nur der geaenderte Schluessel.
  await page.click('#btnThema'); await page.waitForTimeout(250);
  check('Ein Klick auf der Seite schaltet um', await attr(page, 'data-thema') === 'dunkel');
  check('KRITISCH: und geht ans Konto', posts.length === 2 && JSON.stringify(posts[1]) === JSON.stringify({ thema: 'dunkel' }));
  await page.click('#btnGlas'); await page.waitForTimeout(250);
  check('Glas ebenso', posts.length === 3 && JSON.stringify(posts[2]) === JSON.stringify({ glas: 'an' }));
  check('Der Browser behaelt seine Kopie fuer das naechste Laden',
    await page.evaluate(() => localStorage.getItem('rv3_thema') === 'dunkel' && localStorage.getItem('rv3_glas') === 'an'));
  await browser.close();
}

// ── 4) Das Konto gewinnt ───────────────────────────────────────────────────
{
  const { browser, page, posts } = await starte({ thema: 'dunkel', glas: 'an', konto: { thema: 'hell', glas: 'aus', dichte: 'normal' } });
  await page.waitForTimeout(300);
  check('KRITISCH: ein anderes Geraet hat hell gespeichert -- hier gilt jetzt auch hell',
    await attr(page, 'data-thema') === 'hell' && await attr(page, 'data-glas') === 'aus');
  check('Die Schalter stehen passend',
    await page.evaluate(() => $('btnThema').getAttribute('aria-checked') === 'false'
      && $('btnGlas').getAttribute('aria-checked') === 'false'));
  check('Der Browser merkt sich den Kontowert fuer das naechste Laden',
    await page.evaluate(() => localStorage.getItem('rv3_thema') === 'hell' && localStorage.getItem('rv3_glas') === 'aus'));
  check('KRITISCH: das Uebernehmen vom Konto schreibt nichts zurueck', posts.length === 0);
  await browser.close();
}

// ── 5) Einrichtung fehlt / Antwort ohne Auskunft ───────────────────────────
{
  const { browser, page, posts } = await starte({ thema: 'dunkel', konto: 'unbekannt' });
  await page.evaluate(() => go('einstellungen')); await page.waitForTimeout(200);
  const nurBrowser = await standText(page);
  check('Fehlt die Einrichtung, sagt die Seite "nur in diesem Browser"',
    /nur in diesem browser/i.test(nurBrowser) && /einrichtung/i.test(nurBrowser));
  check('und hebt das hervor', await page.evaluate(() => $('esStand').classList.contains('warn')));
  await page.click('#btnThema'); await page.waitForTimeout(250);
  check('Umschalten geht trotzdem -- im Browser', await attr(page, 'data-thema') === 'hell');
  check('KRITISCH: es wird nichts hochgeladen, was der Server nicht speichern kann', posts.length === 0);
  await browser.close();

  const z = await starte({ thema: 'dunkel', konto: 'stumm' });
  await z.page.evaluate(() => go('einstellungen')); await z.page.waitForTimeout(200);
  const stumm = await standText(z.page);
  check('KRITISCH: eine Antwort ohne Auskunft wird nicht als "nichts gespeichert" gelesen',
    z.posts.length === 0 && await attr(z.page, 'data-thema') === 'dunkel');
  check('Vier Lagen, vier Saetze: "unbekannt" sieht anders aus als "am Konto" und "nur Browser"',
    stumm !== nurBrowser && !/gespeichert an deinem konto/i.test(stumm) && stumm.length > 20);
  await z.browser.close();
}

// ── 6) Handy: der Schalter in der Schublade schreibt ebenfalls ans Konto ───
{
  const { browser, page, posts } = await starte({ breite: 390, thema: 'dunkel', konto: { thema: 'dunkel', glas: 'an', dichte: 'normal' } });
  check('Am Handy steht "Einstellungen" nicht im Menue (mobiler Zuschnitt steht noch aus)',
    await page.evaluate(() => !$('nav-einstellungen').getClientRects().length));
  await page.click('.btn-burger'); await page.waitForTimeout(400);
  await page.click('#btnThemaMob'); await page.waitForTimeout(250);
  check('KRITISCH: der Schalter in der Handy-Schublade schreibt ans selbe Konto',
    posts.length === 1 && posts[0].thema === 'hell');
  await browser.close();
}

// ── 7) Pro Schluessel uebernehmen ──────────────────────────────────────────
// Hat zuerst die App ihre eigene Wahl gespeichert, ist das Konto nicht mehr
// leer -- die Wahl des Cockpits fehlt trotzdem und muss einmal kommen.
{
  const { browser, page, posts } = await starte({ thema: 'hell', glas: 'aus', konto: { app_thema: 'dunkel' } });
  await page.waitForTimeout(300);
  check('KRITISCH: steht nur die App-Wahl am Konto, uebernimmt das Cockpit trotzdem seine eigene',
    posts.length === 1 && posts[0].thema === 'hell' && posts[0].glas === 'aus' && !('app_thema' in posts[0]));
  check('Die App-Wahl faerbt das Cockpit nicht (ENT-398: zwei Entscheidungen)',
    await attr(page, 'data-thema') === 'hell');
  await browser.close();
}

// ── 8) App der Mitarbeitenden: eigene Wahl, am Konto ───────────────────────
async function app({ geraet, konto }) {
  const browser = await chromium.launch({ executablePath: browserPfad() });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const fehler = [], posts = [];
  page.on('pageerror', e => fehler.push(e.message));
  if (geraet) {
    await page.addInitScript(v => { try { localStorage.setItem('rv3_app_thema', v); } catch (e) {} }, geraet);
  }
  await page.route('**/api/**', route => {
    const u = route.request().url();
    const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.includes('login')) return send({ status: 'ok', token: 't', name: 'muster.person', ist_admin: false });
    if (u.includes('meine_einstellungen')) {
      if (route.request().method() === 'POST') {
        posts.push(JSON.parse(route.request().postData()).einstellungen);
        return send({ status: 'ok', einstellungen: {} });
      }
      if (konto === 'stumm') return send({ status: 'ok' });
      return send({ status: 'ok', einstellungen: konto });
    }
    if (u.includes('meine_schichten')) return send({ status: 'ok', schichten: [] });
    return send({ status: 'ok' });
  });
  await page.goto(`file://${WURZEL}/app.html`);
  await page.fill('#gName', 'a'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
  await page.waitForSelector('#app.on'); await page.waitForTimeout(500);
  return { browser, page, fehler, posts };
}
{
  const a = await app({ geraet: 'hell', konto: { thema: 'dunkel', glas: 'an' } });
  check('KRITISCH: App ohne eigene Kontowahl uebernimmt einmal, was das Telefon wusste',
    a.posts.length === 1 && JSON.stringify(a.posts[0]) === JSON.stringify({ app_thema: 'hell' }));
  check('Die Cockpit-Wahl am Konto faerbt die App nicht', await attr(a.page, 'data-thema') === 'hell');
  await a.page.evaluate(() => themaUm()); await a.page.waitForTimeout(200);
  check('KRITISCH: Umschalten in der App geht ans Konto, unter eigenem Schluessel',
    a.posts.length === 2 && JSON.stringify(a.posts[1]) === JSON.stringify({ app_thema: 'dunkel' }));
  check('Keine JavaScript-Fehler in der App', a.fehler.length === 0);
  await a.browser.close();

  const b = await app({ geraet: 'dunkel', konto: { app_thema: 'hell' } });
  check('KRITISCH: ein anderes Telefon hat hell gespeichert -- hier gilt jetzt auch hell',
    await attr(b.page, 'data-thema') === 'hell');
  check('und das Telefon merkt es sich fuers naechste Starten',
    await b.page.evaluate(() => localStorage.getItem('rv3_app_thema') === 'hell'));
  check('Das Uebernehmen vom Konto schreibt nichts zurueck', b.posts.length === 0);
  await b.browser.close();

  const c = await app({ geraet: 'hell', konto: 'stumm' });
  await c.page.evaluate(() => themaUm()); await c.page.waitForTimeout(200);
  check('Ohne Auskunft vom Konto bleibt die App beim Telefon und laedt nichts hoch',
    c.posts.length === 0 && await attr(c.page, 'data-thema') === 'dunkel');
  await c.browser.close();
}

// ── 9) Betreiberbereich: gleiche Seite, eigenes Konto ─────────────────────
async function betreiber({ thema = 'dunkel', glas = 'an', konto }) {
  const browser = await chromium.launch({ executablePath: browserPfad() });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const fehler = [], posts = [];
  page.on('pageerror', e => fehler.push(e.message));
  await page.addInitScript(([t, g]) => {
    try { localStorage.setItem('rv3_thema', t); localStorage.setItem('rv3_glas', g);
          sessionStorage.setItem('betreiber-token', 't'); } catch (e) {}
  }, [thema, glas]);
  await page.route('**/api/**', route => {
    const u = route.request().url();
    const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.includes('betreiber_zf_status')) return send({ status: 'ok', eingerichtet: true });
    if (u.includes('betreiber_einstellungen')) {
      if (route.request().method() === 'POST') {
        posts.push(JSON.parse(route.request().postData()).einstellungen);
        return send({ status: 'ok', einstellungen: {} });
      }
      return send({ status: 'ok', einstellungen: konto });
    }
    return send({ status: 'ok', mandanten: [], liste: [], eintraege: [], konten: [], belege: [] });
  });
  await page.goto(`file://${WURZEL}/betreiber.html`);
  await page.waitForSelector('#haus:not(.versteckt)'); await page.waitForTimeout(500);
  return { browser, page, fehler, posts };
}
{
  const a = await betreiber({ thema: 'hell', glas: 'aus', konto: null });
  check('KRITISCH Betreiber: in der Kopfleiste steht kein Schalter mehr',
    await a.page.evaluate(() => !document.querySelector('.leiste-rechts .thema-schalter, .leiste-rechts .glas-schalter')));
  check('Betreiber: leeres Konto uebernimmt einmal, was der Browser wusste',
    a.posts.length === 1 && a.posts[0].thema === 'hell' && a.posts[0].glas === 'aus');
  await a.page.click('#btnMarke'); await a.page.waitForTimeout(200);
  await a.page.click('#knopf-einstellungen'); await a.page.waitForTimeout(250);
  check('Betreiber: das Kontomenue fuehrt auf die Einstellungsseite',
    await a.page.isVisible('#b-einstellungen') && (await a.page.textContent('#leiste-titel')).trim() === 'Einstellungen');
  check('Betreiber: dort stehen beide Schalter', await a.page.isVisible('#btn-thema') && await a.page.isVisible('#btn-glas'));
  check('Betreiber: die Seite sagt, wo die Wahl gespeichert ist',
    /gespeichert an deinem konto/i.test(await a.page.textContent('#es-stand')));
  await a.page.click('#btn-thema'); await a.page.waitForTimeout(250);
  check('KRITISCH Betreiber: Umschalten geht ans Betreiber-Konto',
    a.posts.length === 2 && JSON.stringify(a.posts[1]) === JSON.stringify({ thema: 'dunkel' }));
  const lage = await a.page.evaluate(() => {
    const t = $('btn-thema').getBoundingClientRect(), g = $('btn-glas').getBoundingClientRect();
    return Math.abs(t.right - g.right) <= 1 && g.top >= t.bottom;
  });
  check('Betreiber: die Schalter stehen untereinander auf einer Linie', lage);
  await a.page.screenshot({ path: `${OUT}/einstellungen-betreiber.png` });
  check('Betreiber: keine JavaScript-Fehler', a.fehler.length === 0);
  await a.browser.close();

  const b = await betreiber({ thema: 'dunkel', glas: 'an', konto: { thema: 'hell', glas: 'aus' } });
  check('KRITISCH Betreiber: der Kontowert gilt', await attr(b.page, 'data-thema') === 'hell'
    && await attr(b.page, 'data-glas') === 'aus');
  check('Betreiber: das Uebernehmen vom Konto schreibt nichts zurueck', b.posts.length === 0);
  await b.browser.close();
}

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
