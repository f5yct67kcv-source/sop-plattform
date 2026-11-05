// Benachrichtigungen auf der Einstellungsseite (16.10.2026).
//
// Entscheid des Projektinhabers: Je Art ein Schalter. Ausgeschaltet heisst:
// erscheint nicht in der EIGENEN Glocke und zaehlt nicht zur Zahl daran --
// nichts wird als gelesen markiert, die Uebersicht zeigt weiterhin alles.
// Vorfall und Supportantwort sind immer an.
//
// Gefiltert wird auf dem Server (pruef_ereignisse.php prueft das). Hier wird
// die Oberflaeche gemessen: die Schalter, was ans Konto geht, und dass die
// Glocke ihre eigene Liste zeigt und abhakt -- nicht die der Uebersicht.
// Der nachgestellte Server filtert die Glocke wie der echte nach dem, was am
// Konto steht.
//
// KEIN festes Datum in dieser Datei (test_datumsfest.mjs).
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const jetzt = new Date();
const zeit = minuten => new Date(jetzt.getTime() - minuten * 60000).toISOString().slice(0, 19).replace('T', ' ');
const heute = jetzt.toISOString().slice(0, 10);
const person = { mitarbeiter_id: 1, name: 'anna', vorname: 'Anna', nachname: 'Muster' };
// Die beiden neuesten sind Rapporte: Ist die Glocke gefiltert, steht an
// erster Stelle etwas anderes als in der Uebersicht.
const ALLE = [
  { typ: 'rapport', id: 11, zeit: zeit(5), titel: 'Rapport eingegangen', datum: heute, kunde: 'Muster AG', ...person },
  { typ: 'rapport', id: 12, zeit: zeit(10), titel: 'Rapport eingegangen', datum: heute, kunde: 'Muster AG', ...person },
  { typ: 'sperrtag', id: 21, zeit: zeit(20), titel: 'Tag gesperrt', datum: heute, ...person },
  { typ: 'vorfall', id: 31, zeit: zeit(30), titel: 'Vorfall gemeldet', objekt: 'Lager Beispiel', ...person },
];

async function starte({ konto = {}, ereignisse = ALLE, speichern = 'ok' } = {}) {
  const browser = await chromium.launch({ executablePath: browserPfad() });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const fehler = [], posts = [], haken = [];
  const amKonto = konto === 'unbekannt' ? null : { ...konto };
  page.on('pageerror', e => fehler.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('rv3_huelle', 'aus'); } catch (e) {} });
  const rr = ['planung_lesen', 'kunden_lesen', 'plan'];
  await page.route('**/api/**', route => {
    const u = route.request().url();
    const send = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.includes('login')) return send({ status: 'ok', token: 't', name: 'muster.person', ist_admin: false, rechte: rr, rollen: ['planung'] });
    if (u.includes('me.php')) return send({ status: 'ok', name: 'muster.person', ist_admin: false, rechte: rr, rollen: ['planung'] });
    if (u.includes('meine_einstellungen')) {
      if (route.request().method() === 'POST') {
        const neu = JSON.parse(route.request().postData()).einstellungen;
        posts.push(neu);
        // Wie der echte Endpunkt: ohne Spalte 409 und "unbekannt".
        if (konto === 'unbekannt') return send({ status: 'error', stand_unbekannt: true }, 409);
        if (speichern === 'fehler') return send({ status: 'error', message: 'kaputt' }, 500);
        Object.assign(amKonto, neu);
        return send({ status: 'ok', einstellungen: amKonto });
      }
      if (konto === 'unbekannt') return send({ status: 'ok', einstellungen: null, stand_unbekannt: true });
      return send({ status: 'ok', einstellungen: { thema: 'dunkel', glas: 'aus', dichte: 'normal', farbe: 'graphit', ...amKonto } });
    }
    if (u.includes('ereignis_erledigt')) {
      haken.push(JSON.parse(route.request().postData()));
      return send({ status: 'ok' });
    }
    if (u.includes('dashboard_stats')) {
      const offen = ereignisse.filter(x => !haken.some(h => h.typ === x.typ && h.id === x.id));
      const aus = amKonto ? ['rapport', 'sperrtag', 'zusage', 'offerte', 'rundgang_spontan']
        .filter(a => amKonto['glocke_' + a] === 'aus') : [];
      const zaehle = l => l.reduce((j, x) => { j[x.typ] = (j[x.typ] || 0) + 1; return j; }, {});
      const gl = offen.filter(x => !aus.includes(x.typ));
      return send({ status: 'ok', stand: zeit(0), kpi: { rapporte_monat: 0, rapporte_vormonat: 0,
        stunden_monat: 0, stunden_vormonat: 0, mitarbeiter: 0, kunden: 0, rapporte_total: 0 },
        verlauf: [], angemeldet: [], letzte_rapporte: [], pro_mitarbeiter: [],
        ereignisse: offen, ereignisse_gesamt: offen.length, ereignisse_gekuerzt: false,
        ereignisse_je_art: zaehle(offen), ereignisse_unvollstaendig: [],
        glocke: { ereignisse: gl, gesamt: gl.length, gekuerzt: false, je_art: zaehle(gl), aus } });
    }
    return send({ status: 'ok', kunden: [], rapporte: [], feiertage: [], gepflegt: {}, sperren: [], einsaetze: [], mitarbeiter: [] });
  });
  await page.goto(`file://${WURZEL}/dashboard.html`);
  await page.fill('#gName', 'a'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
  await page.waitForSelector('#shell.on'); await page.waitForTimeout(600);
  return { browser, page, fehler, posts, haken };
}
const oeffnen = async page => {
  await page.evaluate(() => { go('einstellungen'); esReiterZeigen('benachrichtigungen'); });
  await page.waitForTimeout(200);
};
const schalter = page => page.evaluate(() => [...document.querySelectorAll('#esGlockeArten .glocke-schalter')]
  .map(b => ({ art: b.dataset.art, an: b.getAttribute('aria-checked') === 'true', gesperrt: b.disabled,
               immer: !!b.parentElement.querySelector('.chip') })));
const badge = page => page.evaluate(() => { const b = $('glockeBadge'); return b.style.display === 'none' ? 0 : Number(b.textContent); });
const glockeTypen = page => page.evaluate(() => glockeEintraege().map(x => x.typ));

// ── 1) Aufbau ──────────────────────────────────────────────────────────────
{
  const { browser, page, fehler, posts } = await starte();
  await oeffnen(page);
  const s = await schalter(page);
  check('Sieben Schalter, einer je Art, die die Glocke zeigt', s.length === 7);
  check('Ohne Gespeichertes sind alle an', s.every(x => x.an));
  check('Fuenf lassen sich schalten', s.filter(x => !x.gesperrt).map(x => x.art).join() === 'rapport,sperrtag,zusage,offerte,rundgang_spontan');
  check('KRITISCH: Vorfall und Supportantwort sind gesperrt, eingeschaltet und tragen "immer an"',
    s.filter(x => x.gesperrt).every(x => x.an && x.immer) && s.filter(x => x.gesperrt).map(x => x.art).join() === 'vorfall,support_antwort');
  check('Die Karte sagt, was Ausschalten bewirkt -- und was nicht',
    await page.evaluate(() => { const t = document.querySelector('.es-teil[data-reiter="benachrichtigungen"]').textContent;
      return /übersicht/i.test(t) && /andere konten/i.test(t) && !/in arbeit/i.test(t); }));
  check('Die Seite sagt, dass die Wahl am Konto steht',
    /konto/i.test(await page.evaluate(() => $('esStandGlocke').textContent)));
  const mass = await page.evaluate(() => {
    const k = [...document.querySelectorAll('#esGlockeArten .glocke-schalter')].map(b => b.getBoundingClientRect());
    const karte = document.querySelector('.es-teil[data-reiter="benachrichtigungen"] .card-bd').getBoundingClientRect();
    return { linie: Math.max(...k.map(r => r.right)) - Math.min(...k.map(r => r.right)), amRand: karte.right - k[0].right,
             hoehe: Math.min(...k.map(r => r.height)), sichtbar: k.every(r => r.width > 0) };
  });
  check('Die Schalter stehen auf einer senkrechten Linie', mass.sichtbar && mass.linie <= 1);
  check('und am rechten Rand der Karte', mass.amRand <= 24);
  check('Gleich gross wie die Schalter der Darstellung (30 px hoch)', Math.round(mass.hoehe) === 30);
  await page.screenshot({ path: `${OUT}/einstellungen-glocke.png` });
  check('Beim Oeffnen wird nichts hochgeladen', posts.length === 0);
  check('Keine JavaScript-Fehler', fehler.length === 0);
  await browser.close();
}

// ── 2) Ausschalten wirkt auf die Glocke, nicht auf die Uebersicht ──────────
{
  const { browser, page, fehler, posts, haken } = await starte();
  check('Vorbedingung: die Glocke zaehlt alle vier', await badge(page) === 4);
  await oeffnen(page);
  await page.click('#esGlockeArten .glocke-schalter[data-art="rapport"]'); await page.waitForTimeout(400);
  check('KRITISCH: ein Klick geht ans Konto -- nur der eine Schluessel',
    posts.length === 1 && JSON.stringify(posts[0]) === JSON.stringify({ glocke_rapport: 'aus' }));
  check('Der Schalter steht danach aus', (await schalter(page)).find(x => x.art === 'rapport').an === false);
  check('KRITISCH: die Glocke zeigt keine Rapporte mehr', (await glockeTypen(page)).join() === 'sperrtag,vorfall');
  check('KRITISCH: und zaehlt sie nicht mit', await badge(page) === 2);
  check('KRITISCH: die Uebersicht zeigt weiterhin alle vier',
    await page.evaluate(() => (stats.ereignisse || []).length === 4));
  check('Ausschalten hakt nichts ab', haken.length === 0);

  // Der Haken in der Glocke trifft die Zeile der GLOCKE. An erster Stelle
  // steht dort der Sperrtag, in der Uebersicht ein Rapport.
  await page.evaluate(() => glockeErledigt(0)); await page.waitForTimeout(300);
  check('KRITISCH: der Haken in der Glocke hakt die Zeile der Glocke ab, nicht die der Uebersicht',
    haken.length === 1 && haken[0].typ === 'sperrtag' && haken[0].id === 21);
  check('Sie verschwindet aus beiden Listen',
    await page.evaluate(() => !glockeEintraege().some(x => x.typ === 'sperrtag') && !stats.ereignisse.some(x => x.typ === 'sperrtag')));
  check('Die Zahl an der Glocke geht mit herunter', await badge(page) === 1);

  await page.click('#esGlockeArten .glocke-schalter[data-art="rapport"]'); await page.waitForTimeout(400);
  check('Wieder eingeschaltet, kommen die Rapporte zurueck',
    posts.length === 2 && posts[1].glocke_rapport === 'an' && await badge(page) === 3);
  check('Keine JavaScript-Fehler', fehler.length === 0);
  await browser.close();
}

// ── 3) Nur Ausgeschaltetes offen: kein "Nichts Neues" ohne Zusatz ──────────
{
  const { browser, page, fehler } = await starte({ konto: { glocke_rapport: 'aus' }, ereignisse: ALLE.slice(0, 2) });
  check('Glocke ohne Zahl', await badge(page) === 0);
  const text = await page.evaluate(() => $('glockeListe').textContent.trim());
  check('KRITISCH: die leere Glocke sagt, dass in der Uebersicht noch etwas steht',
    /übersicht/i.test(text) && /2 weitere/.test(text));
  check('Der gespeicherte Schalter steht aus',
    (await (async () => { await oeffnen(page); return schalter(page); })()).find(x => x.art === 'rapport').an === false);
  check('Keine JavaScript-Fehler', fehler.length === 0);
  await browser.close();
}

// ── 4) Einrichtung fehlt / Speichern scheitert ─────────────────────────────
{
  const { browser, page, posts } = await starte({ konto: 'unbekannt' });
  await oeffnen(page);
  check('Fehlt die Einrichtung, sind alle Schalter gesperrt', (await schalter(page)).every(x => x.gesperrt));
  const t = await page.evaluate(() => $('esStandGlocke').textContent);
  check('und die Seite sagt warum -- und dass die Glocke bis dahin alles zeigt',
    /einrichtung/i.test(t) && /alles/i.test(t) && !/nur in diesem browser/i.test(t));
  await page.evaluate(() => glockeArtUm('rapport')); await page.waitForTimeout(200);
  check('Auch am Schalter vorbei geht nichts ans Konto',
    !posts.some(p => 'glocke_rapport' in p));
  await browser.close();
}
{
  const { browser, page, posts } = await starte({ speichern: 'fehler' });
  await oeffnen(page);
  await page.click('#esGlockeArten .glocke-schalter[data-art="zusage"]'); await page.waitForTimeout(400);
  check('Vorbedingung: der Versuch ging hinaus', posts.length === 1);
  check('KRITISCH: scheitert das Speichern, springt der Schalter zurueck',
    (await schalter(page)).find(x => x.art === 'zusage').an === true);
  check('und die Seite sagt es', /abgeglichen/i.test(await page.evaluate(() => $('esStandGlocke').textContent)));
  await browser.close();
}

console.log(`${ok.length} Pruefungen bestanden`);
if (bad.length) { console.log(`${bad.length} FEHLGESCHLAGEN:\n - ` + bad.join('\n - ')); process.exit(1); }
