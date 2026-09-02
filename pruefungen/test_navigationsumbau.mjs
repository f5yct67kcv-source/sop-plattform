// Mobile Navigationsstruktur (ENT-234): Wächter-Reiter (nur mit
// Revierdienst-Bezug), Menü-Reiter mit Kacheln (löst den früheren
// Profil-Reiter ab), Plan+Sperren als Unterreiter, Hinweis-Chip bei
// aktivem Rundgang auf "Heute". Prüft die Weiche selbst -- die Checkliste,
// das Scannen, Pausieren/Abbrechen usw. bleiben unveraendert und sind
// bereits an anderer Stelle abgedeckt.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const EXE = browserPfad();
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
// Gestern, nicht heute: darfRundgang() prueft nur den Start, nicht das Ende --
// ein Datum von gestern ist unabhaengig von der Tageszeit beim Testlauf
// zuverlaessig "bereits begonnen", ohne ein festes Datum zu brauchen.
const GESTERN = iso(new Date(Date.now() - 864e5));
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const schicht = (overrides = {}) => ({
  id: 41, kunde_name: 'Beispiel AG', titel: 'Schliessrunde', strasse: 'Industriestrasse 1',
  ort: '4601 Olten', einsatzart: 'Revierdienst', datum: GESTERN, von: '22:00:00', bis: '22:30:00',
  status: 'geplant', bemerkung: null, zusage: 'zugesagt', objekt_name: 'Muster Center',
  im_team: 1, hat_kontrollpunkte: true, ...overrides,
});

async function neueSeite(schichten, extraRoutes, profilUeberschreibung) {
  const rufe = [];
  const browser = await chromium.launch({ executablePath: EXE });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
  await page.route('**/api/**', route => {
    const req = route.request(), u = req.url(), p = u.split('/api/')[1].split('?')[0];
    let body = null;
    try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch (e) {}
    rufe.push({ p, body, url: u });
    const send = (b, s) => route.fulfill({ status: s || 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'a', ist_admin: false });
    if (p.includes('meine_schichten')) return send({ status: 'ok', schichten });
    // ENT-284: die Berechtigung steuert seit dann den Waechter-Reiter, nicht
    // mehr hat_kontrollpunkte auf einer geladenen Schicht -- Vorgabe
    // 'berechtigt', damit bestehende Faelle hier (Reiter sichtbar, Kacheln
    // erreichbar) unveraendert bleiben; wer das Gegenteil pruefen will,
    // uebergibt profilUeberschreibung.
    if (p.includes('mein_profil')) return send({ status: 'ok', profil: {
      name: 'a', vorname: 'A', nachname: 'B', revierdienst_berechtigt: true, ...profilUeberschreibung } });
    if (p.includes('meine_verfuegbarkeit')) return send({ status: 'ok', tage: [] });
    if (p.includes('rapport_list')) return send({ status: 'ok', rapporte: [] });
    if (extraRoutes) {
      const r = extraRoutes(p, body, send);
      if (r) return r;
    }
    return send({ status: 'ok' });
  });
  await page.goto(`file://${WURZEL}/app.html`);
  await page.fill('#gName', 'a'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
  await page.waitForSelector('#app.on'); await page.waitForTimeout(500);
  return { browser, page, rufe };
}

// ══════ TEIL 1: Wächter-Reiter erscheint mit Berechtigung, mit zwei Kacheln
{
  const { browser, page } = await neueSeite([schicht()]);
  check('Wächter-Reiter ist sichtbar', await page.isVisible('#t-waechter'));
  check('Fünf sichtbare Reiter mit Revierdienst-Bezug',
    await page.evaluate(() => [...document.querySelectorAll('.tabs button')]
      .filter(b => getComputedStyle(b).display !== 'none').length === 5));
  await page.click('#t-waechter'); await page.waitForTimeout(250);
  check('Genau zwei Kacheln im Wächter-Bereich', await page.isVisible('#mk-rundgang') && await page.isVisible('#mk-schluessel'));
  await page.click('#mk-schluessel'); await page.waitForTimeout(200);
  check('Schlüsselverwaltung meldet sich ehrlich als noch nicht gebaut statt stumm nichts zu tun',
    (await page.textContent('#toast')).includes('späteren Schritt') && await page.evaluate(() => document.getElementById('toast').classList.contains('on')));
  await page.screenshot({ path: OUT + '/nav-01-waechter.png' });
  await browser.close();
}

// ══════ TEIL 2: Rundgänge-Kachel öffnet die objektübergreifende Übersicht,
// unabhängig von der eigenen, heutigen Zuteilung (ENT-279-Fortsetzung) --
// Auswahl startet spontan über mein_rundgang_spontan_starten.php.
{
  const VORLAGEN = [{ id: 900, name: 'Nachtrunde', objekt_name: 'Muster Center', kunde_name: 'Beispiel AG',
    fenster_von: null, fenster_bis: null }];
  const { browser, page, rufe } = await neueSeite([schicht({ id: 55 })], (p, body, send) => {
    if (p.includes('mein_rundgang_vorlagen_alle')) return send({ status: 'ok', vorlagen: VORLAGEN });
    // Vor der allgemeineren "spontan_starten"-Zeile: seit ENT-294 laedt das
    // Antippen zuerst diese rein lesende Vorschau.
    if (p.includes('mein_rundgang_uebersicht')) return send({ status: 'ok',
      vorlage: { id: 900, name: 'Nachtrunde', fenster_von: null, fenster_bis: null },
      objekt: { id: 7, name: 'Musterobjekt Industrie', strasse: 'Musterweg 4', ort: '9999 Musterdorf', kanton: 'SO' },
      kunde_name: 'Musterliegenschaften AG', kontrollpunkte: [{ id: 1, bezeichnung: 'Tor', typ: 'geofence' }],
      ansprechpartner: [] });
    if (p.includes('mein_rundgang_spontan_starten')) return send({ status: 'ok', einsatz_id: 900, rundgang_id: 77, kontrollpunkte: [] });
  });
  await page.click('#t-waechter'); await page.waitForTimeout(250);
  await page.click('#mk-rundgang'); await page.waitForTimeout(350);
  check('KRITISCH: die Kachel öffnet die Übersicht (Blatt-Titel „Rundgänge"), nicht direkt eine Schicht',
    await page.evaluate(() => document.getElementById('blatt').classList.contains('on'))
    && (await page.textContent('#blTitel')) === 'Rundgänge');
  check('Die verfügbare Kontrollrunde steht mit Objekt und Kunde da',
    (await page.textContent('#blBody')).includes('Nachtrunde') && (await page.textContent('#blBody')).includes('Muster Center'));

  // Seit ENT-294 liegt zwischen Auswahl und Start die Vorschau-Vollseite:
  // Das blosse Antippen darf nichts mehr anlegen (sonst entstehen die
  // gemeldeten "Spontaner Rundgang"-Karteileichen im Einsatzplan), erst der
  // Knopf dort startet. Die Aussage bleibt dieselbe -- gestartet wird genau
  // diese Vorlage, ohne Ausnahmegrund --, sie durchlaeuft nur beide Schritte.
  rufe.length = 0;
  await page.click('#blBody button');
  await page.waitForTimeout(350);
  check('KRITISCH: die Auswahl öffnet die Vorschau und startet noch NICHTS',
    await page.isVisible('#rgSeite')
    && !rufe.some(r => r.p.includes('mein_rundgang_spontan_starten')));
  await page.click('#rgsStartBtn');
  await page.waitForTimeout(300);
  const start = rufe.find(r => r.p.includes('mein_rundgang_spontan_starten'));
  check('KRITISCH: der Startknopf löst den spontanen Start für genau diese Vorlage aus',
    start && start.body.vorlage_id === 900 && !('ausnahme_grund' in start.body));
  check('Nach Erfolg werden die eigenen Schichten neu geladen (der spontane Einsatz muss dort auffindbar sein)',
    rufe.some(r => r.p.includes('meine_schichten')));
  await browser.close();
}

// ══════ TEIL 3: keine verfügbaren Rundgänge -> ehrlicher Leerzustand statt
// stiller Leere in der Übersicht selbst (nicht mehr ein Toast, seit die
// Kachel immer die Übersicht öffnet statt eine Schicht zu suchen)
{
  const { browser, page } = await neueSeite([schicht({ zusage: 'offen' })], (p, body, send) => {
    if (p.includes('mein_rundgang_vorlagen_alle')) return send({ status: 'ok', vorlagen: [] });
  });
  check('Wächter-Reiter bleibt trotz fehlender Zusage sichtbar (Kontrollpunkte allein entscheiden)',
    await page.isVisible('#t-waechter'));
  await page.click('#t-waechter'); await page.waitForTimeout(250);
  await page.click('#mk-rundgang'); await page.waitForTimeout(300);
  check('KRITISCH: die Übersicht öffnet sich trotzdem (sie ist von der eigenen Zuteilung unabhängig)',
    await page.evaluate(() => document.getElementById('blatt').classList.contains('on')));
  check('Ohne verfügbare Vorlagen zeigt sie einen ehrlichen Leerzustand, keine leere Fläche',
    (await page.textContent('#blBody')).includes('Keine Rundgänge verfügbar'));
  await browser.close();
}

// ══════ TEIL 4: ohne Berechtigung bleibt der Reiter weg (ENT-284) -- auch
// wenn eine geladene Schicht Kontrollpunkte hat. Bis ENT-284 entschied genau
// das (hat_kontrollpunkte auf der Schicht) allein -- jetzt entscheidet die
// Berechtigung, die Schicht spielt fuer die Reiter-Sichtbarkeit keine Rolle
// mehr.
{
  const { browser, page } = await neueSeite([schicht()], undefined, { revierdienst_berechtigt: false });
  check('Wächter-Reiter bleibt ohne Berechtigung verborgen, obwohl die Schicht Kontrollpunkte hat',
    !(await page.isVisible('#t-waechter')));
  check('Vier sichtbare Reiter ohne Revierdienst-Bezug',
    await page.evaluate(() => [...document.querySelectorAll('.tabs button')]
      .filter(b => getComputedStyle(b).display !== 'none').length === 4));
  await browser.close();
}

// ══════ TEIL 4b: KRITISCH -- mit Berechtigung, aber OHNE jede Schicht bleibt
// der Reiter sichtbar. Das ist der Konflikt, der ENT-284 ausgeloest hat: ein
// Waechter, der spontan an einem Objekt eine Runde laufen will, dem er
// (noch) nicht zugeteilt ist -- vorher blieb ihm der Reiter genau dann
// verschlossen, wenn die spontane Uebersicht (ENT-282) ihn gebraucht haette.
{
  const { browser, page } = await neueSeite([], undefined, { revierdienst_berechtigt: true });
  check('KRITISCH: Wächter-Reiter bleibt sichtbar, obwohl keine einzige Schicht geladen ist',
    await page.isVisible('#t-waechter'));
  await browser.close();
}

// ══════ TEIL 5: Plan/Sperren-Unterreiter -- kein neuer Serveraufruf beim Wechsel
{
  const { browser, page, rufe } = await neueSeite([schicht({ hat_kontrollpunkte: false })]);
  await page.click('#t-plan'); await page.waitForTimeout(250);
  check('Der Plan-Inhalt ist zu Beginn sichtbar', await page.isVisible('#plan-inhalt-plan'));
  check('Der Sperren-Inhalt ist zu Beginn verborgen', !(await page.isVisible('#plan-inhalt-sperren')));
  const vorher = rufe.length;
  await page.click('#pu-sperren'); await page.waitForTimeout(150);
  check('Sperren-Inhalt wird nach dem Umschalten sichtbar', await page.isVisible('#plan-inhalt-sperren'));
  check('Plan-Inhalt wird dabei verborgen', !(await page.isVisible('#plan-inhalt-plan')));
  check('Der Unterreiter-Wechsel läuft ohne neuen Serveraufruf (Daten liegen schon vor)', rufe.length === vorher);
  await page.click('#pu-plan'); await page.waitForTimeout(150);
  check('Zurück zu Plan zeigt den Plan-Inhalt wieder', await page.isVisible('#plan-inhalt-plan'));
  await browser.close();
}

// ══════ TEIL 6: aktiver Rundgang zeigt einen Chip auf "Heute" und führt zurück
{
  const { browser, page } = await neueSeite([schicht({ id: 77 })], (p, body, send) => {
    if (p.includes('mein_rundgang_offen')) return send({ status: 'ok', rundgang: null });
    if (p.includes('mein_rundgang_vorlagen')) return send({ status: 'ok', vorlagen: [] });
    if (p.includes('mein_rundgang_starten')) return send({ status: 'ok', rundgang_id: 9, kontrollpunkte: [
      { id: 1, bezeichnung: 'Haupteingang', typ: 'nfc' }, { id: 2, bezeichnung: 'Tiefgarage', typ: 'nfc' }] });
  });
  await page.evaluate(() => blattAuf(77));
  await page.waitForTimeout(350);
  await page.click('#blRundgang button');
  await page.waitForTimeout(350);
  check('Die Checkliste öffnet sich nach dem Start', await page.isVisible('#rdListe'));
  // Seit ENT-306 ist die laufende Runde eine Vollseite ueber der Reiterleiste
  // der App (z-index 55 gegen 50). Man verlaesst sie mit dem Zurueck-Pfeil,
  // nicht indem man an ihr vorbeitippt -- genau das prueft die naechste
  // Zeile mit.
  check('KRITISCH: die Reiterleiste der App ist waehrend der laufenden Runde verdeckt',
    await page.evaluate(() => {
      const t = document.querySelector('.tabs').getBoundingClientRect();
      const oben = document.elementFromPoint(t.left + t.width / 2, t.top + t.height / 2);
      return !!oben && !oben.closest('.tabs');
    }));
  // Seit ENT-324 verlaesst der Pfeil eine laufende Runde nicht mehr
  // stillschweigend, sondern stellt dieselbe Frage wie „Beenden"
  // (Pausieren / Abbrechen / Weiter). Der Weg zum Chip auf „Heute" fuehrt
  // also ueber „Pausieren" -- was zum Chip passt: Er ist ausdruecklich fuer
  // den aktiven UND den pausierten Rundgang gebaut (ENT-234).
  await page.click('#rgsZurueck');
  await page.waitForTimeout(250);
  check('KRITISCH: der Pfeil fragt bei laufender Runde nach, statt sie offen stehen zu lassen',
    await page.evaluate(() => document.getElementById('blatt').classList.contains('on')));
  await page.click('#blBody .btn-plain');   // Pausieren
  await page.waitForTimeout(400);
  await page.click('#t-heute'); await page.waitForTimeout(250);
  check('Auf Heute erscheint der Rundgang-Chip', await page.isVisible('.rd-chip'));
  const chipTxt = await page.textContent('.rd-chip');
  check('Der Chip nennt den Fortschritt (0 von 2)', /0/.test(chipTxt) && /2/.test(chipTxt));
  await page.click('.rd-chip');
  await page.waitForTimeout(300);
  check('Der Chip führt zurück in dieselbe Checkliste', await page.isVisible('#rdListe'));
  await page.screenshot({ path: OUT + '/nav-02-chip.png' });
  await browser.close();
}

// ══════ GEGENPROBE zu Teil 6: ohne aktiven Rundgang bleibt der Chip weg
// (CLAUDE.md: eine Prüfung, die nie angeschlagen hat, ist eine Behauptung --
// dieser Fall stellt sicher, dass rundgangChipHtml() tatsaechlich bedingt ist.)
{
  const { browser, page } = await neueSeite([schicht({ hat_kontrollpunkte: false })]);
  await page.click('#t-heute'); await page.waitForTimeout(200);
  check('KRITISCH: ohne aktiven Rundgang zeigt Heute keinen Chip', !(await page.isVisible('.rd-chip')));
  await browser.close();
}

// ══════ MOBIL/DESKTOP: neue Kacheln und Reiter halten die 44px-Regel ein
for (const [breite, bez] of [[360, 'Handy'], [1024, 'Desktop']]) {
  const { browser, page } = await neueSeite([schicht()]);
  await page.setViewportSize({ width: breite, height: 844 });
  await page.waitForTimeout(150);
  await page.click('#t-waechter'); await page.waitForTimeout(200);
  const kacheln = await page.evaluate(() => [...document.querySelectorAll('#v-waechter .mk-kachel')]
    .map(b => b.getBoundingClientRect().height));
  check(`Wächter-Kacheln mindestens 44px hoch @${bez}`, kacheln.every(h => h >= 44));
  await page.click('#t-menu'); await page.waitForTimeout(200);
  const menuKacheln = await page.evaluate(() => [...document.querySelectorAll('#v-menu .mk-kachel')]
    .map(b => b.getBoundingClientRect().height));
  check(`Menü-Kacheln mindestens 44px hoch @${bez}`, menuKacheln.every(h => h >= 44));
  const tabHoehen = await page.evaluate(() => [...document.querySelectorAll('.tabs button')]
    .filter(b => getComputedStyle(b).display !== 'none').map(b => b.getBoundingClientRect().height));
  check(`Alle sichtbaren Reiter mindestens 44px hoch @${bez}`, tabHoehen.every(h => h >= 44));
  const scroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`Kein Seiten-Scroll im Wächter/Menü-Bereich @${bez}`, scroll <= 1);
  await browser.close();
}

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
