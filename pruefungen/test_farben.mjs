// Farbthemen auf der Einstellungsseite (ENT-726, 16.10.2026).
//
// Entscheid des Projektinhabers: drei Themen (Graphit, Marine, Hell), jedes
// mit eigener dunkler Fassung; hell/dunkel bleibt ein eigener Schalter. Nur
// Oberflaeche und Akzent -- die Statusfarben bleiben in jedem Thema gleich.
// Nur am Desktop; am Handy bleibt Graphit. Die Uhr-Kacheln folgen nicht.
// Gewaehlt wird ueber drei Kacheln mit kleiner Vorschau, gespeichert am Konto.
//
// Gemessen wird am gerenderten Zustand: welche Farben tatsaechlich auf der
// Leiste, den Knoepfen und den Flaechen liegen -- nicht, was im CSS steht.
//
// KEIN festes Datum in dieser Datei (test_datumsfest.mjs).
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const THEMEN = ['graphit', 'marine', 'hell'];
const FASSUNGEN = ['hell', 'dunkel'];

async function starte(browser, { konto = { thema: 'hell' }, breite = 1440, huelle = 'aus', speicher = {} } = {}) {
  const page = await browser.newPage({ viewport: { width: breite, height: 900 } });
  const fehler = [], posts = [];
  const amKonto = konto === 'unbekannt' ? null : { glas: 'aus', dichte: 'normal', ...konto };
  page.on('pageerror', e => fehler.push(e.message));
  await page.addInitScript(([h, sp]) => {
    try { localStorage.setItem('rv3_huelle', h); Object.entries(sp).forEach(([k, v]) => localStorage.setItem(k, v)); } catch (e) {}
  }, [huelle, speicher]);
  await page.route('**/api/**', route => {
    const u = route.request().url();
    const send = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.includes('login') || u.includes('me.php')) return send({ status: 'ok', token: 't', name: 'muster.person', ist_admin: false, rechte: ['plan'], rollen: [] });
    if (u.includes('meine_einstellungen')) {
      if (route.request().method() === 'POST') {
        const neu = JSON.parse(route.request().postData()).einstellungen;
        posts.push(neu);
        if (konto === 'unbekannt') return send({ status: 'error', stand_unbekannt: true }, 409);
        Object.assign(amKonto, neu);
        return send({ status: 'ok', einstellungen: amKonto });
      }
      if (konto === 'unbekannt') return send({ status: 'ok', einstellungen: null, stand_unbekannt: true });
      return send({ status: 'ok', einstellungen: { ...amKonto } });
    }
    if (u.includes('dashboard_stats')) {
      return send({ status: 'ok', stand: '', kpi: { rapporte_monat: 0, rapporte_vormonat: 0, stunden_monat: 0,
        stunden_vormonat: 0, mitarbeiter: 0, kunden: 0, rapporte_total: 0 }, verlauf: [], angemeldet: [],
        letzte_rapporte: [], pro_mitarbeiter: [], ereignisse: [], ereignisse_gesamt: 0, ereignisse_gekuerzt: false,
        ereignisse_je_art: {}, ereignisse_unvollstaendig: [], glocke: { ereignisse: [], gesamt: 0, gekuerzt: false, je_art: {}, aus: [] } });
    }
    return send({ status: 'ok', kunden: [], rapporte: [], feiertage: [], gepflegt: {}, sperren: [], einsaetze: [], mitarbeiter: [] });
  });
  await page.goto(`file://${WURZEL}/dashboard.html`);
  await page.fill('#gName', 'a'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
  await page.waitForSelector('#shell.on'); await page.waitForTimeout(600);
  return { page, fehler, posts };
}

// Kontrast nach WCAG aus zwei berechneten Farben ("rgb(...)" / "rgba(...)").
const KONTRAST = `
  window.__kontrast = (a, b) => {
    const kanal = s => s.match(/[\\d.]+/g).slice(0, 3).map(Number);
    const lum = c => { const [r, g, b] = c.map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
      return .2126 * r + .7152 * g + .0722 * b; };
    const [x, y] = [lum(kanal(a)), lum(kanal(b))].sort((p, q) => q - p);
    return (x + .05) / (y + .05);
  };`;

// Was jede Fassung liefern muss: die Farben, die tatsaechlich auf dem
// Bildschirm liegen, und die Kontraste der Texte darauf.
const messen = page => page.evaluate(KONTRAST + `
  (() => {
    const cs = el => getComputedStyle(el);
    const wurzel = cs(document.documentElement);
    const v = n => wurzel.getPropertyValue(n).trim().toUpperCase();
    const side = document.querySelector('.side');
    const leiste = cs(side).backgroundColor;
    const nav = [...document.querySelectorAll('.side .nav-item')].find(n => n.offsetParent && !n.classList.contains('on'));
    const navAn = document.querySelector('.side .nav-item.on');
    // Ein Knopf im Akzent, eigens gebaut: Nicht jede Ansicht hat gerade einen.
    let k = document.getElementById('__pk');
    if (!k) { k = document.createElement('button'); k.id = '__pk'; k.className = 'btn btn-primary'; k.textContent = 'x';
      document.querySelector('.es-inhalt').appendChild(k); }
    const karte = document.querySelector('.es-teil[data-reiter="farben"]');
    const flaeche = cs(karte).backgroundColor;
    const t = document.createElement('span'); karte.appendChild(t);
    t.style.color = 'var(--ink-2)'; const ink2 = cs(t).color;
    t.style.color = 'var(--ink-3)'; const ink3 = cs(t).color;
    t.style.color = 'var(--accent)'; const akzent = cs(t).color;
    t.remove();
    const uhr = cs(document.getElementById('zeitDatum'));
    const gewaehlt = document.querySelector('#esFarbKacheln .farb-kachel[aria-checked="true"]');
    return {
      leiste, flaeche, grund: cs(document.body).backgroundColor, akzentFarbe: akzent,
      vorschau: gewaehlt ? { leiste: cs(gewaehlt.querySelector('.fv-leiste')).backgroundColor,
        knopf: cs(gewaehlt.querySelector('.fv-knopf')).backgroundColor,
        grund: cs(gewaehlt.querySelector('.farb-vorschau')).backgroundColor } : null,
      semantik: ['--pos', '--pos-soft', '--neg', '--neg-soft', '--warn', '--warn-soft', '--serie', '--serie-soft',
                 '--aw-ferien', '--aw-ferien-soft', '--aw-andere', '--aw-andere-soft', '--fin-lohn', '--test-violett'].map(n => n + '=' + v(n)).join(' '),
      uhr: uhr.backgroundColor + ' ' + uhr.backgroundImage + ' ' + uhr.color,
      k: {
        nav: nav ? __kontrast(cs(nav).color, leiste) : 0,
        navAn: navAn ? __kontrast(cs(navAn).color, cs(navAn).backgroundColor) : 99,
        knopf: __kontrast(cs(k).color, cs(k).backgroundColor),
        // Die Meldung unten steht auf --shell mit weisser Schrift; bei einer
        // weissen Leiste waere sie unsichtbar.
        toast: __kontrast(cs(document.getElementById('toast')).color, cs(document.getElementById('toast')).backgroundColor),
        ink2: __kontrast(ink2, flaeche), ink3: __kontrast(ink3, flaeche), akzent: __kontrast(akzent, flaeche),
      },
    };
  })()`);

const oeffnen = async page => {
  await page.evaluate(() => { go('einstellungen'); esReiterZeigen('farben'); });
  await page.waitForTimeout(150);
};
const kacheln = page => page.evaluate(() => [...document.querySelectorAll('#esFarbKacheln .farb-kachel')]
  .map(k => ({ id: k.dataset.farbe, an: k.getAttribute('aria-checked') === 'true', rolle: k.getAttribute('role') })));

const browser = await chromium.launch({ executablePath: browserPfad() });

// ── 1) Aufbau und Wahl ────────────────────────────────────────────────────
{
  const { page, fehler, posts } = await starte(browser);
  await oeffnen(page);
  const k = await kacheln(page);
  check('Drei Kacheln: Graphit, Marine, Hell', k.map(x => x.id).join() === 'graphit,marine,hell');
  check('Ohne gespeicherte Wahl ist Graphit gewaehlt -- und nur Graphit', k.filter(x => x.an).map(x => x.id).join() === 'graphit');
  check('Die Kacheln sind als Auswahlgruppe ausgezeichnet (eine aus drei)',
    k.every(x => x.rolle === 'radio') && await page.evaluate(() => $('esFarbKacheln').getAttribute('role') === 'radiogroup'));
  check('Kein "in Arbeit" mehr, weder am Reiter noch in der Karte',
    await page.evaluate(() => !/in arbeit/i.test(document.querySelector('.es-teil[data-reiter="farben"]').textContent)
      && !document.querySelector('.es-nav-knopf[data-reiter="farben"] .es-inarbeit')));
  check('Die Karte sagt, dass die Statusfarben bleiben und dass es nur am Computer gilt',
    await page.evaluate(() => { const t = document.querySelector('.es-teil[data-reiter="farben"]').textContent;
      return /status/i.test(t) && /handy/i.test(t); }));
  check('Die Seite sagt, dass die Wahl am Konto steht', /konto/i.test(await page.evaluate(() => $('esStandFarben').textContent)));

  const mass = await page.evaluate(() => {
    const r = [...document.querySelectorAll('#esFarbKacheln .farb-kachel')].map(b => b.getBoundingClientRect());
    const bd = document.querySelector('.es-teil[data-reiter="farben"] .card-bd').getBoundingClientRect();
    return { oben: new Set(r.map(x => Math.round(x.top))).size, breiten: r.map(x => Math.round(x.width)),
             hoehen: r.map(x => Math.round(x.height)), links: Math.round(r[0].left - bd.left), rechts: Math.round(bd.right - r[2].right) };
  });
  check('Die drei Kacheln stehen auf einer Linie', mass.oben === 1);
  check(`und sind gleich breit und gleich hoch (${mass.breiten} / ${mass.hoehen})`,
    new Set(mass.breiten).size === 1 && new Set(mass.hoehen).size === 1);
  check(`Die Reihe fuellt die Karte gleichmaessig (links ${mass.links}, rechts ${mass.rechts})`, Math.abs(mass.links - mass.rechts) <= 1);

  const vorher = await messen(page);
  const vorKlick = posts.length;
  await page.click('.farb-kachel[data-farbe="marine"]'); await page.waitForTimeout(200);
  const nachher = await messen(page);
  check('Klick auf Marine waehlt Marine und nur Marine',
    (await kacheln(page)).filter(x => x.an).map(x => x.id).join() === 'marine');
  check('KRITISCH: die Leiste wechselt sofort ihre Farbe -- gemessen, nicht nachgelesen', vorher.leiste !== nachher.leiste);
  check('Ans Konto geht genau die Farbwahl, nichts sonst',
    posts.length === vorKlick + 1 && JSON.stringify(posts[vorKlick]) === JSON.stringify({ farbe: 'marine' }));
  check('Der Browser merkt sich die Wahl fuer das naechste Laden (kein Aufblitzen)',
    await page.evaluate(() => localStorage.getItem('rv3_farbe') === 'marine'));

  // Tastatur: Pfeil nach rechts wandert weiter, wie bei Optionsfeldern.
  await page.focus('.farb-kachel[data-farbe="marine"]');
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(150);
  check('Mit der Pfeiltaste wandert die Wahl zur naechsten Kachel, und der Fokus mit',
    await page.evaluate(() => document.activeElement.dataset.farbe === 'hell'
      && document.documentElement.getAttribute('data-farbe') === 'hell'));
  await page.screenshot({ path: `${OUT}/einstellungen-farben.png` });

  // Die Vorschau zeigt die Fassung, die gilt: nach dem Wechsel auf dunkel
  // muss die Graphit-Kachel die dunkle Flaeche zeigen.
  const vorschau = () => page.evaluate(() => getComputedStyle(document.querySelector('.farb-kachel[data-farbe="graphit"] .farb-vorschau')).backgroundColor);
  const hellV = await vorschau();
  await page.evaluate(() => themaSetzen('dunkel')); await page.waitForTimeout(100);
  check('Die Vorschau folgt hell/dunkel', hellV !== await vorschau());
  check('Keine JavaScript-Fehler', fehler.length === 0);
  await page.close();
}

// ── 2) Sechs Fassungen, gemessen ──────────────────────────────────────────
// Massstab ist Graphit in derselben Fassung: Kein neues Thema darf
// schlechter lesbar sein als das bisherige, und wo Graphit die Schwelle von
// 4.5 erreicht, muss das neue sie auch erreichen.
const fassungen = {};
for (const thema of FASSUNGEN) {
  for (const farbe of THEMEN) {
    for (const huelle of ['aus', 'an']) {
      const { page, fehler } = await starte(browser, { konto: { thema, farbe }, huelle });
      await oeffnen(page);
      fassungen[`${farbe}/${thema}/${huelle}`] = { ...(await messen(page)), fehler: fehler.length };
      if (huelle === 'aus') {
        await page.evaluate(() => go('uebersicht')); await page.waitForTimeout(250);
        await page.screenshot({ path: `${OUT}/farben-${farbe}-${thema}.png` });
      }
      await page.close();
    }
  }
}
for (const [name, f] of Object.entries(fassungen)) {
  const [farbe, thema, huelle] = name.split('/');
  const basis = fassungen[`graphit/${thema}/${huelle}`];
  const zuSchwach = Object.entries(f.k).filter(([k, wert]) => wert + 0.05 < Math.min(4.5, basis.k[k]))
    .map(([k, wert]) => `${k} ${wert.toFixed(2)} statt ${Math.min(4.5, basis.k[k]).toFixed(2)}`);
  check(`${name}: jeder Text so lesbar wie in Graphit (${zuSchwach.join(', ') || 'ok'})`, zuSchwach.length === 0);
  if (farbe !== 'graphit') {
    check(`KRITISCH ${name}: die Statusfarben sind dieselben wie in Graphit`, f.semantik === basis.semantik);
    check(`${name}: die Uhr-Kacheln folgen dem Thema nicht`, f.uhr === basis.uhr);
    check(`${name}: die Leiste sieht anders aus als in Graphit`, f.leiste !== basis.leiste);
  }
  // Die Vorschau auf der Kachel ist eine zweite Liste derselben Farben
  // (FARBTHEMEN im Skript). Sie muss zeigen, was nach dem Klick dasteht.
  check(`${name}: die Vorschau der gewaehlten Kachel zeigt die echte Leiste, Flaeche und den echten Akzent`,
    f.vorschau && f.vorschau.leiste === f.leiste && f.vorschau.knopf === f.akzentFarbe && f.vorschau.grund === f.grund);
  check(`${name}: keine JavaScript-Fehler`, f.fehler === 0);
}
// Hell und dunkel muessen in jedem Thema wirklich hell und dunkel sein --
// faellt die dunkle Fassung eines Themas aus (Spezifitaet), stuende sonst
// eine helle Flaeche im dunklen Modus.
const helligkeit = s => { const [r, g, b] = s.match(/[\d.]+/g).map(Number); return (r + g + b) / 3; };
for (const farbe of THEMEN) {
  check(`KRITISCH ${farbe}: die dunkle Fassung ist dunkel, die helle hell`,
    helligkeit(fassungen[`${farbe}/dunkel/aus`].flaeche) < 60 && helligkeit(fassungen[`${farbe}/hell/aus`].flaeche) > 200);
}
check('Marine dunkel und Hell dunkel sind eigene Fassungen, nicht Graphit dunkel',
  new Set(THEMEN.map(f => fassungen[`${f}/dunkel/aus`].grund)).size === 3);

// ── 3) Am Handy bleibt Graphit ────────────────────────────────────────────
{
  const leisten = {};
  for (const farbe of ['graphit', 'marine', 'hell']) {
    const { page } = await starte(browser, { konto: { thema: 'hell', farbe }, breite: 390 });
    leisten[farbe] = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
      + ' ' + getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
      + ' ' + getComputedStyle(document.documentElement).getPropertyValue('--shell').trim());
    await page.close();
  }
  check('KRITISCH: am Handy sieht jedes Thema aus wie Graphit (mobiler Zuschnitt nicht entschieden)',
    leisten.marine === leisten.graphit && leisten.hell === leisten.graphit);
}

// ── 4) Laden, Speicher, Einrichtung ───────────────────────────────────────
{
  // Vor dem ersten Zeichnen: Der Kopf der Seite setzt das Thema aus dem
  // Browser, noch ohne Anmeldung und ohne Antwort vom Konto.
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(() => { try { localStorage.setItem('rv3_farbe', 'marine'); } catch (e) {} });
  await page.goto(`file://${WURZEL}/dashboard.html`);
  check('Das gespeicherte Thema steht schon vor der Anmeldung am Dokument',
    await page.evaluate(() => document.documentElement.getAttribute('data-farbe') === 'marine'));
  await page.close();

  const p2 = await browser.newPage();
  await p2.addInitScript(() => { try { localStorage.setItem('rv3_farbe', 'wald'); } catch (e) {} });
  await p2.goto(`file://${WURZEL}/dashboard.html`);
  check('Ein unbekannter Wert im Browser fuehrt zu Graphit', await p2.evaluate(() => document.documentElement.getAttribute('data-farbe') === 'graphit'));
  await p2.close();
}
{
  const { page, fehler } = await starte(browser, { konto: { thema: 'hell', farbe: 'pink' } });
  await oeffnen(page);
  check('Ein unbekannter Wert am Konto fuehrt zu Graphit, nicht zu einem halben Thema',
    await page.evaluate(() => document.documentElement.getAttribute('data-farbe') === 'graphit')
    && (await kacheln(page)).filter(x => x.an).map(x => x.id).join() === 'graphit');
  check('und ohne Fehler', fehler.length === 0);
  await page.close();
}
{
  // Am Konto steht Hell, der Browser hat noch Marine: Das Konto gilt.
  const { page, posts } = await starte(browser, { konto: { thema: 'hell', farbe: 'hell' }, speicher: { rv3_farbe: 'marine' } });
  check('Was am Konto steht, gilt -- nicht der Zwischenspeicher des Browsers',
    await page.evaluate(() => document.documentElement.getAttribute('data-farbe') === 'hell'));
  check('und es wird nichts zurueckgeschrieben', !posts.some(p => 'farbe' in p));
  await page.close();
}
{
  // Ein Konto ohne Farbwahl: Die Wahl dieses Browsers wird einmal uebernommen.
  const { page, posts } = await starte(browser, { konto: { thema: 'hell' }, speicher: { rv3_farbe: 'marine' } });
  check('Fehlt die Farbwahl am Konto, wird die des Browsers einmal uebernommen',
    posts.some(p => p.farbe === 'marine'));
  await page.close();
}
{
  const { page, fehler } = await starte(browser, { konto: 'unbekannt' });
  await oeffnen(page);
  await page.click('.farb-kachel[data-farbe="marine"]'); await page.waitForTimeout(200);
  check('Ohne Einrichtung wirkt die Wahl trotzdem in diesem Browser',
    await page.evaluate(() => document.documentElement.getAttribute('data-farbe') === 'marine'));
  check('und die Seite sagt deutlich, dass sie nur im Browser steht',
    await page.evaluate(() => $('esStandFarben').classList.contains('warn') && /browser/i.test($('esStandFarben').textContent)));
  check('ohne Fehler', fehler.length === 0);
  await page.close();
}

await browser.close();

console.log(`${ok.length} Pruefungen bestanden`);
if (bad.length) { console.log(`${bad.length} FEHLGESCHLAGEN:\n - ` + bad.join('\n - ')); process.exit(1); }
