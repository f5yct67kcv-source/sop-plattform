// Laufende Ortung waehrend der Runde und die lokale Radius-Vorpruefung
// (ENT-317, revidiert ENT-131 teilweise).
//
// Vom Projektinhaber entschieden und begruendet: "das System, so wie wir es
// bauen, braucht die kontinuierliche Ortung, damit es sauber klappt ...
// ansonsten koennen solche kleine Radien und auf kurzer Distanz nicht
// umgesetzt werden. Wenn der Rundgang beendet wird, wird die Verfolgung
// nicht mehr aktiv."
//
// Zwei Dinge werden hier besonders genau geprueft, weil an ihnen der Wert
// des ganzen Werkzeugs haengt:
//  1. Die Ortung laeuft NUR waehrend einer laufenden Runde. Sie darf eine
//     beendete, abgebrochene oder pausierte Runde nicht ueberdauern -- so
//     ausdruecklich verlangt.
//  2. Ein Punkt laesst sich NICHT bestaetigen, wenn man ausserhalb des
//     Radius steht -- und zwar schon im Geraet, nicht erst am Server. Vorher
//     sah offline jeder Punkt bestaetigt aus, und die Ruecknahme kam
//     Stunden spaeter.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { GOOGLE_MAPS_MOCK } from './google_maps_mock.mjs';
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const APP = readFileSync(`${WURZEL}/app.html`, 'utf8');
const RG = readFileSync(`${WURZEL}/backend/rundgang.php`, 'utf8');

// Siehe test_rundgang_karte.mjs: ein Klick ins Leere reisst sonst die
// ganze Suite mit, und eine abgestuerzte Suite meldet keine rote Pruefung.
const klick = async s => { try { await page.click(s, { timeout: 2500 }); return true; }
                           catch (e) { return false; } };
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const tag = n => iso(new Date(Date.now() + n * 864e5));

// ══════════ QUELLTEXT: DIE REGELN ════════════════════════════════════
check('KRITISCH: der Server prüft die Distanz weiterhin selbst — ein Gerät ist nie die letzte Instanz',
  /function rundgang_scan_pruefen/.test(RG)
  && /geo_distanz_meter/.test(RG)
  && /Ausserhalb des Kontrollpunkt-Bereichs/.test(RG));
check('KRITISCH: die App rechnet dieselbe Distanz, damit es OHNE Netz funktioniert',
  /function rgDistanzMeter/.test(APP) && /6371000/.test(APP));
check('KRITISCH: die Ortung wird gestoppt, nicht nur gestartet',
  /function rgOrtungStoppen/.test(APP) && /clearWatch/.test(APP));
// Eine Stelle entscheidet, ob geortet wird -- wer das an jedem
// Zustandswechsel einzeln einbaut, vergisst genau den einen.
check('KRITISCH: eine einzige Stelle entscheidet über die Ortung',
  /function rgOrtungNachfuehren/.test(APP)
  && /status !== 'abgeschlossen'/.test(APP)
  && /status !== 'abgebrochen'/.test(APP)
  && /status !== 'pausiert'/.test(APP));
check('Beim Verlassen der Seite wird die Ortung beendet und die Position verworfen',
  /rgOrtungStoppen\(\);\s*\/\/[^\n]*\n\s*rgsMeinOrt = null;/.test(APP));
// Diese Suite deckt die Ortung IM GERAET ab (ENT-317). Die Uebermittlung
// der Spur kam mit ENT-318 dazu und hat eine eigene Suite (test_spur).
// Hier stand zunaechst die Pruefung, dass die Position das Geraet NICHT
// verlaesst -- richtig fuer Schritt 1, ueberholt durch Schritt 2. Sie ist
// ersetzt durch die Grenze, die bleibt: Ortung und Uebermittlung sind
// getrennte Bausteine, damit die Uebermittlung abschaltbar bleibt, ohne
// dass die Bedienbarkeit der Radien darunter leidet.
check('KRITISCH: Ortung und Übermittlung sind getrennte Bausteine',
  /function rgOrtungStarten/.test(APP) && /function rgSpurSenden/.test(APP)
  && !/rgSpurSenden\(\)[\s\S]{0,40}watchPosition/.test(APP));

const RUNDE = { id: 951, status: 'laeuft', pausiert_seit: null,
  vorbereitet_am: tag(0) + ' 02:00:00', pause_minuten: 0,
  objekt: { id: 7, name: 'Musterobjekt', strasse: 'Musterweg 4', ort: '9999 Musterdorf' },
  kunde_name: 'Musterliegenschaften AG', ansprechpartner: [], zentrale: null,
  kontrollpunkte: [
    // Punkt 1 liegt GENAU auf der vorgetaeuschten Position, Punkt 2 rund
    // 900 m entfernt -- weit ausserhalb jedes Radius.
    { id: 1, bezeichnung: 'Haupteingang', reihenfolge: 1, typ: 'geofence',
      lat: 47.3500, lng: 7.9000, geofence_radius_m: 25, erledigt: null, aufgaben: [] },
    { id: 2, bezeichnung: 'Parkhaus', reihenfolge: 2, typ: 'geofence',
      lat: 47.3580, lng: 7.9000, geofence_radius_m: 20, erledigt: null, aufgaben: [] },
  ] };

const SCHICHTEN = { status: 'ok', von: tag(-30), bis: tag(90), schichten: [
  { id: 71, kunde_name: 'Musterliegenschaften AG', titel: 'Nachtwache',
    strasse: 'Musterweg 4', ort: '9999 Musterdorf', einsatzart: 'Revierdienst',
    sparte: 'sicherheit', datum: tag(0), von: '20:00:00', bis: '06:00:00',
    status: 'bestaetigt', bemerkung: null, zusage: 'zugesagt',
    objekt_name: 'Musterobjekt', objekt_id: 7, hat_kontrollpunkte: true, im_team: 1 }]};
const PROFIL = { status: 'ok', monat: { anzahl: 0, stunden: 0 },
  profil: { name: 'm.muster', ist_admin: false, personalnummer: 'P-001',
    vorname: 'Max', nachname: 'Muster', erstellt_am: tag(-30) + ' 10:00:00' } };

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
  permissions: ['geolocation'],
  geolocation: { latitude: 47.3500, longitude: 7.9000, accuracy: 8 },
});
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));

let letzterScan = null;
await page.route('**/api/**', route => {
  const p = new URL(route.request().url()).pathname.split('/api/')[1];
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'm.muster', ist_admin: false });
  if (p.includes('meine_schichten')) return send(SCHICHTEN);
  if (p.includes('mein_profil')) return send(PROFIL);
  if (p.includes('rapport_list')) return send({ status: 'ok', rapporte: [] });
  if (p.includes('mein_rundgang_offen')) return send({ status: 'ok', rundgang: JSON.parse(JSON.stringify(RUNDE)) });
  if (p.includes('mein_rundgang_scan')) {
    letzterScan = JSON.parse(route.request().postData() || '{}');
    return send({ status: 'ok', rundgang_status: 'laeuft',
      ergebnisse: (letzterScan.scans || []).map(x => ({ kontrollpunkt_id: x.kontrollpunkt_id, status: 'ok' })),
      aufgaben_ergebnisse: [] });
  }
  return send({ status: 'ok' });
});
await page.route('**maps.googleapis.com/**', route =>
  route.fulfill({ status: 200, contentType: 'application/javascript', body: GOOGLE_MAPS_MOCK }));

await page.goto(`file://${WURZEL}/app.html`);
await page.fill('#gName', 'm.muster');
await page.fill('#gPass', 'x');
await page.click('#gBtn');
await page.waitForSelector('.app.on');
await page.waitForTimeout(400);
await page.evaluate(() => ladeSchichten().then(() => rundgangFortsetzen(71)));
await page.waitForTimeout(1400);

// ══════════ DIE ORTUNG DARF DIE RUNDE NICHT MITREISSEN ═══════════════
// Beim Bauen stand rgOrtungNachfuehren() eine Zeile zu frueh -- vor dem
// Riegel in rgLaufZeichnen(). Ein Fehler in watchPosition riss damit die
// ganze Seite mit, und der Waechter sah einen leeren Rumpf statt seiner
// Kontrollpunkte. Von der Regression gefunden (test_rundgang), nicht von
// dieser Suite -- darum steht die Pruefung jetzt hier.
check('KRITISCH: die Ortung wird erst NACH dem Riegel angestossen, nicht davor',
  /function rgLaufZeichnen\(\) \{\s*\n\s*if \(rgsModus !== 'lauf'/.test(APP));
check('KRITISCH: ein Fehler in der Ortung kann nicht nach aussen schlagen',
  /try \{\s*\n\s*rgsOrtWache = navigator\.geolocation\.watchPosition/.test(APP)
  && /try \{ navigator\.geolocation\.clearWatch/.test(APP));
// Die Seite muss stehen, auch wenn die Ortung reihenweise scheitert.
// Seit ENT-331 beginnt eine Runde auf dem Kartenreiter -- der Reiter wird
// hier ausdruecklich auf die Liste gestellt, damit diese Pruefung weiter
// genau das misst, was sie messen soll (der Rumpf mit den Kontrollpunkten
// steht), und nicht nebenbei zur Reiter-Pruefung wird.
check('KRITISCH: die Kontrollpunkte stehen auch dann, wenn die Ortung wirft',
  await page.evaluate(() => {
    const echt = navigator.geolocation.watchPosition;
    navigator.geolocation.watchPosition = () => { throw new Error('kaputt'); };
    rgOrtungStoppen();
    rgsReiter = 'punkte';
    let stand = false;
    try { rgLaufZeichnen(); stand = !!document.getElementById('rdListe'); } catch (e) { stand = false; }
    navigator.geolocation.watchPosition = echt;
    return stand;
  }));
await page.evaluate(() => { rgOrtungStoppen(); rgLaufZeichnen(); });
await page.waitForTimeout(400);

// ══════════ ORTUNG LÄUFT ══════════════════════════════════════════════
check('KRITISCH: auf einer laufenden Runde wird geortet',
  await page.evaluate(() => rgsOrtWache !== null));
check('Die eigene Position ist im Gerät bekannt',
  await page.evaluate(() => rgsMeinOrt !== null && Math.abs(rgsMeinOrt.lat - 47.35) < 0.01));

// ══════════ ENTFERNUNG IN DER LISTE ═══════════════════════════════════
await page.click('#rgsRt-punkte');
await page.waitForTimeout(400);
const zeilen = await page.evaluate(() =>
  [...document.querySelectorAll('.rd-ort')].map(e => ({ txt: e.textContent.trim(), kl: e.className })));
check('KRITISCH: beim nahen Punkt steht, dass man im Bereich ist',
  zeilen.length === 2 && /im Bereich/.test(zeilen[0].txt) && /drin/.test(zeilen[0].kl));
check('KRITISCH: beim fernen Punkt steht die Entfernung in Metern',
  zeilen.length === 2 && /\d+ m/.test(zeilen[1].txt) && /weit/.test(zeilen[1].kl));
// Rund 890 m -- die Rechnung muss stimmen, nicht nur irgendeine Zahl zeigen.
check('KRITISCH: die Entfernung ist richtig gerechnet, nicht geschätzt',
  await page.evaluate(() => {
    const d = rdEntfernungZu(rundgangAktiv.kontrollpunkte[1]);
    return d > 850 && d < 920;
  }));

// ══════════ DER KNOPF SPERRT ══════════════════════════════════════════
check('KRITISCH: der Bestätigen-Knopf des NAHEN Punktes ist bedienbar',
  await page.isEnabled('#rdBtn1'));
check('KRITISCH: der Bestätigen-Knopf des FERNEN Punktes ist gesperrt',
  await page.isDisabled('#rdBtn2'));
await page.screenshot({ path: `${OUT}/ortung-01-liste.png` });

// ══════════ DIE VORPRÜFUNG GREIFT AUCH BEI DIREKTEM AUFRUF ════════════
// Der gesperrte Knopf ist die Bequemlichkeit; die Pruefung in
// rdBestaetigen() ist der eigentliche Riegel. Ein Aufruf an der
// Oberflaeche vorbei darf nicht durchkommen.
letzterScan = null;
await page.evaluate(() => rdBestaetigen(2));
await page.waitForTimeout(900);
check('KRITISCH: ein Punkt ausserhalb des Radius wird NICHT als erledigt eingetragen',
  await page.evaluate(() => rundgangAktiv.kontrollpunkte[1].erledigt === null));
check('KRITISCH: und es geht auch nichts in die Warteschlange — offline wäre er sonst "bestätigt"',
  await page.evaluate(() => rdWarteschlangeLesen()
    .filter(e => Number(e.kontrollpunkt_id) === 2).length === 0));
check('Der Grund steht mit der Entfernung da, nicht nur "geht nicht"',
  await page.evaluate(() => {
    const el = document.getElementById('rdFehler2');
    return el && /\d+ m/.test(el.textContent) && el.style.display !== 'none';
  }));

// ══════════ DER NAHE PUNKT GEHT DURCH ═════════════════════════════════
await page.evaluate(() => rdBestaetigen(1));
await page.waitForTimeout(900);
check('KRITISCH: der Punkt IM Bereich lässt sich bestätigen',
  await page.evaluate(() => rundgangAktiv.kontrollpunkte[0].erledigt !== null));
check('Die Position wird beim Scan mitgeschickt, damit der Server nachprüfen kann',
  letzterScan !== null && Array.isArray(letzterScan.scans)
  && letzterScan.scans[0] && letzterScan.scans[0].lat !== null);

// ══════════ ORTUNG ENDET MIT DER RUNDE ════════════════════════════════
// Vom Projektinhaber ausdruecklich verlangt: "wenn der Rundgang beendet
// wird, wird die Verfolgung nicht mehr aktiv."
await page.evaluate(() => { rundgangAktiv.status = 'pausiert'; rgLaufZeichnen(); });
await page.waitForTimeout(300);
check('KRITISCH: eine pausierte Runde wird nicht geortet',
  await page.evaluate(() => rgsOrtWache === null));
await page.evaluate(() => { rundgangAktiv.status = 'laeuft'; rgLaufZeichnen(); });
await page.waitForTimeout(300);
check('Nach dem Fortsetzen läuft die Ortung wieder',
  await page.evaluate(() => rgsOrtWache !== null));
await page.evaluate(() => { rundgangAktiv.status = 'abgeschlossen'; rgLaufZeichnen(); });
await page.waitForTimeout(300);
check('KRITISCH: eine abgeschlossene Runde wird nicht mehr geortet',
  await page.evaluate(() => rgsOrtWache === null));
await page.evaluate(() => { rundgangAktiv.status = 'abgebrochen'; rgLaufZeichnen(); });
await page.waitForTimeout(300);
check('KRITISCH: eine abgebrochene Runde wird nicht mehr geortet',
  await page.evaluate(() => rgsOrtWache === null));

// Und das Verlassen der Seite beendet sie ebenfalls -- sonst ortete das
// Gerät weiter, ohne dass es jemand sieht.
await page.evaluate(() => { rundgangAktiv.status = 'laeuft'; rgLaufZeichnen(); });
await page.waitForTimeout(300);
await page.evaluate(() => rgSeiteZu());
await page.waitForTimeout(300);
check('KRITISCH: das Verlassen der Seite beendet die Ortung',
  await page.evaluate(() => rgsOrtWache === null));
check('KRITISCH: die Position überdauert die Runde nicht',
  await page.evaluate(() => rgsMeinOrt === null));

// ══════════ TRANSPARENZ ═══════════════════════════════════════════════
// Wer geortet wird, muss es sehen koennen.
await page.evaluate(() => rundgangFortsetzen(71));
await page.waitForTimeout(1400);
await page.click('#rgsRt-karte');
await page.waitForTimeout(800);
// REVIDIERT durch ENT-355: Die Aussage steht nicht mehr als Zeile UNTER der
// Karte, sondern als Marke AUF der Karte. ENT-317 gilt unveraendert -- wer
// geortet wird, muss es sehen koennen --, nur der Ort hat gewechselt.
// Darum wird hier schaerfer geprueft als vorher: Es genuegt nicht, dass das
// Element im Baum steht; es muss eine echte Flaeche haben, innerhalb der
// Karte liegen und an seiner Stelle auch wirklich obenauf sein. Eine Marke,
// die hinter der Karte oder ausserhalb des Bildes liegt, ist keine Aussage.
const chip = await page.evaluate(() => {
  const c = document.getElementById('rgsOrtChip');
  const h = document.querySelector('.rgs-karte-huelle');
  if (!c || !h) { return null; }
  const rc = c.getBoundingClientRect(), rh = h.getBoundingClientRect();
  const oben = document.elementFromPoint(rc.left + rc.width / 2, rc.top + rc.height / 2);
  return { text: (c.textContent || '').trim(), breite: rc.width, hoehe: rc.height,
           drin: rc.top >= rh.top - 1 && rc.bottom <= rh.bottom + 1
              && rc.left >= rh.left - 1 && rc.right <= rh.right + 1,
           obenauf: !!oben && (oben === c || c.contains(oben)) };
});
check('KRITISCH: während der Ortung steht sichtbar da, dass geortet wird',
  !!chip && chip.text.includes('Ortung läuft') && chip.breite > 60 && chip.hoehe > 16);
check('KRITISCH: die Ortungsmarke liegt auf der Karte und ist nicht verdeckt',
  !!chip && chip.drin && chip.obenauf);
// Der Punkte-Reiter hat keine Karte -- dort MUSS die Zeile bleiben, sonst
// staende dem Waechter auf diesem Reiter gar nichts mehr ueber seine Ortung.
await page.click('#rgsRt-punkte');
await page.waitForTimeout(400);
check('KRITISCH: auf dem Punkte-Reiter steht die Ortung weiterhin als Zeile',
  await page.isVisible('#rgsOrtungHinweis')
  && (await page.textContent('#rgsOrtungHinweis')).includes('verfolgt'));
await page.click('#rgsRt-karte');
await page.waitForTimeout(600);
check('Die eigene Position steht auf der Karte',
  await page.evaluate(() => rgsStandortMarke !== null));

// ── ENT-331: Wachmann-Zeichen statt weissem Punkt ─────────────────────
// Vom Projektinhaber: "beim Trackersymbol waere es cool, wenn es etwas
// geben wuerde wie Wachmann, oder ein Symbol das auf Security hinweist".
// Der Punkt dahinter ist mehr als Geschmack: Der eigene Standort darf auf
// der Karte nicht aussehen wie ein Ziel. Kontrollpunkte sind Kreise -- ein
// weiterer Kreis in einer weiteren Farbe waere im Dunkeln genau die
// Verwechslung, die niemand bemerkt.
const marken = await page.evaluate(() =>
  [...document.querySelectorAll('#rgsKarte .gm-mock-marker')].map(e => ({
    art: e.dataset.symbolart || '',
    pfad: (e.dataset.pfad || '').length,
    z: Number(e.style.zIndex || 0),
    b: e.getBoundingClientRect().width,
    h: e.getBoundingClientRect().height,
  })));
check('KRITISCH: der eigene Standort trägt ein eigenes Zeichen, keinen Kreis wie ein Kontrollpunkt',
  marken.filter(m => m.art === 'pfad').length === 1
  && marken.filter(m => m.art === 'kreis').length >= 1);
check('KRITISCH: das Zeichen ist wirklich eine Form und keine leere Hülle',
  (marken.find(m => m.art === 'pfad') || { pfad: 0 }).pfad > 30);
// Bewusst UNTER den Kontrollpunkten: Deren Marken tragen ihren Zustand als
// Zeichen (Haken, Ausrufezeichen, Nummer). Das Schild ist groesser als der
// frueher hier gezeichnete Punkt -- oben drueber wuerde es genau diese
// Auskunft verdecken, und zwar in dem Moment, in dem man davorsteht.
check('Es verdeckt keinen Kontrollpunkt, sondern liegt darunter',
  (() => { const eig = marken.find(m => m.art === 'pfad');
    const kps = marken.filter(m => m.art === 'kreis');
    return !!eig && kps.length > 0 && kps.every(k => eig.z < k.z); })());
check('Es ist auf einer nächtlichen Karte auch wirklich zu finden (mindestens 24px, gemessen)',
  (() => { const eig = marken.find(m => m.art === 'pfad');
    return !!eig && eig.b >= 24 && eig.h >= 24; })());
// Der Anker: Das Zeichen muss AUF der Position sitzen, nicht daneben. Ohne
// anchor haengt ein Pfad-Symbol mit seiner linken oberen Ecke an der
// Koordinate -- der eigene Standort waere dann um eine halbe Symbolbreite
// verschoben, und genau das faellt auf einer Karte nie auf, sondern fuehrt
// nur in die falsche Richtung.
check('KRITISCH: das Zeichen sitzt mittig auf der Position, nicht mit der Ecke daneben',
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('#rgsKarte .gm-mock-marker')]
      .find(e => e.dataset.symbolart === 'pfad');
    if (!el || !rgsMeinOrt || !rgsKarte) return false;
    const soll = rgsKarte._latLngZuPixel(rgsMeinOrt.lat, rgsMeinOrt.lng);
    const k = document.getElementById('rgsKarte').getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const ist = { x: r.left - k.left + r.width / 2, y: r.top - k.top + r.height / 2 };
    return Math.abs(ist.x - soll.x) <= 2 && Math.abs(ist.y - soll.y) <= 2;
  }));
// Nach einem Reiterwechsel wird die Karte neu gebaut. Die alte Marke haengt
// dann an einem Container, den es nicht mehr gibt -- ohne Aufraeumen haelt
// die App sie fuer gesetzt und der eigene Standort bliebe unsichtbar.
// Genau dieser Fall war da (ENT-331) und blieb verdeckt, weil der
// Zentrieren-Knopf jedes Mal heimlich eine zweite Marke baute.
await klick('#rgsRt-punkte');
await page.waitForTimeout(300);
await klick('#rgsRt-karte');
await page.waitForTimeout(900);
check('KRITISCH: nach einem Reiterwechsel steht die eigene Position wieder auf der Karte',
  await page.evaluate(() =>
    [...document.querySelectorAll('#rgsKarte .gm-mock-marker')]
      .filter(e => e.dataset.symbolart === 'pfad').length === 1));
// Und der Zentrieren-Knopf darf sie nicht in einen Punkt zurueckverwandeln
// -- vor ENT-331 baute er eine eigene Marke mit eigenem Aussehen.
await klick('#rgsZentrieren');
await page.waitForTimeout(900);
check('KRITISCH: "Zentrieren" verändert das Zeichen nicht und legt keine zweite Marke an',
  await page.evaluate(() => {
    const alle = [...document.querySelectorAll('#rgsKarte .gm-mock-marker')];
    return alle.filter(e => e.dataset.symbolart === 'pfad').length === 1
      && alle.filter(e => e.dataset.symbolart === 'kreis').length === 2;
  }));
await page.screenshot({ path: `${OUT}/ortung-02-karte.png` });

// ══════════ GESTALTUNG, GEMESSEN ══════════════════════════════════════
await page.click('#rgsRt-punkte');
await page.waitForTimeout(400);
check('Die Entfernungszeile fluchtet mit dem Text darüber, nicht mit der Nummer',
  await page.evaluate(() => {
    const bez = document.querySelector('.rd-bez').getBoundingClientRect();
    const ort = document.querySelector('.rd-ort').getBoundingClientRect();
    return Math.abs(bez.left - ort.left) <= 2;
  }));
check('KRITISCH: kein waagrechter Seiten-Scroll bei 390px', await page.evaluate(() =>
  document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(300);
check('KRITISCH: am Desktop kein waagrechter Seiten-Scroll', await page.evaluate(() =>
  document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
