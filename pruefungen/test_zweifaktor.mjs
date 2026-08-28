// Zwei-Faktor-Anmeldung im Browser (ENT-076).
//
// Der Rechenkern wird in pruef_zweifaktor.php gegen die Testvektoren des
// Standards geprueft. Hier geht es um den WEG: Einrichten, Bestaetigen,
// Anmelden, Geraet merken, Abschalten -- und darum, dass an keiner Stelle
// jemand ausgesperrt wird, der nur etwas falsch abgetippt hat.
import { WURZEL, HIER, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

let zfAn = false, zfAngefangen = false, gesendet = null, geraete = [], letzterLogin = null;
const NOTFALL = ['abcd-efgh', 'jkmn-pqrs', 'tuvw-xyz2', 'ab34-cd56'];

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(5000);
const jsFehler = [];
page.on('pageerror', e => jsFehler.push(e.message));

await page.route('**/api/**', r => {
  const u = r.request().url();
  const koerper = () => { try { return JSON.parse(r.request().postData() || '{}'); } catch { return {}; } };
  const send = (x, st = 200) => r.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(x) });

  if (u.includes('login.php')) {
    const b = koerper();
    letzterLogin = b;
    if (b.password !== 'richtig') { return send({ status: 'error', message: 'Name oder Passwort falsch' }, 401); }
    if (zfAn && !b.geraet && !b.code) {
      return send({ status: 'zweifaktor', geraet_tage: 14,
        message: 'Bitte den sechsstelligen Code aus der Authenticator-App eingeben.' });
    }
    if (zfAn && !b.geraet && b.code !== '123456' && !NOTFALL.includes(b.code)) {
      return send({ status: 'error', message: 'Der Code stimmt nicht.' }, 401);
    }
    return send({ status: 'ok', token: 't', name: 'adrian', ist_admin: true,
      geraet: (b.geraet_merken && zfAn) ? 'GERAETEWERT' : '' });
  }
  if (u.includes('zweifaktor_status')) {
    return send({ status: 'ok', eingerichtet: true, moeglich: true, an: zfAn,
      angefangen: zfAngefangen, notfallcodes_offen: zfAn ? 9 : 0,
      geraete, geraet_tage: 14 });
  }
  if (u.includes('zweifaktor_start')) {
    zfAngefangen = true;
    return send({ status: 'ok', geheimnis: 'ABCD EFGH IJKL MNOP QRST UVWX YZ23 4567',
      adresse: 'otpauth://totp/CUPI%2024:adrian?secret=ABCDEFGH' });
  }
  if (u.includes('zweifaktor_bestaetigen')) {
    gesendet = koerper();
    if (gesendet.code !== '123456') {
      return send({ status: 'error', message: 'Der Code stimmt nicht. Stimmt die Uhrzeit auf dem Handy?' }, 400);
    }
    zfAn = true;
    return send({ status: 'ok', notfallcodes: NOTFALL });
  }
  if (u.includes('zweifaktor_aus')) {
    gesendet = koerper();
    if (gesendet.passwort !== 'richtig') { return send({ status: 'error', message: 'Passwort falsch' }, 401); }
    zfAn = false; geraete = [];
    return send({ status: 'ok' });
  }
  if (u.includes('zweifaktor_geraet_weg')) {
    gesendet = koerper();
    geraete = gesendet.id ? geraete.filter(g => g.id !== gesendet.id) : [];
    return send({ status: 'ok' });
  }
  if (u.includes('anstellungsorte')) return send({ status: 'ok', orte: [] });
  if (u.includes('mitarbeiter_list')) return send({ status: 'ok', mitarbeiter: [], listen: {}, eingerichtet: true });
  return send({ status: 'ok', kpi: {}, verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [],
    mitarbeiter: [], kunden: [], einsaetze: [], objekte: [], rapporte: [], orte: [], feiertage: [], gepflegt: {} });
});

// Wartet auf die angemeldete Oberflaeche. Bleibt sie aus, ist das ein Befund
// und keine Zeitueberschreitung -- sonst bricht die Datei ab, statt die
// betroffene Pruefung rot zu faerben.
const warteDrin = async () => {
  try { await page.waitForSelector('#shell.on', { timeout: 4000 }); return true; }
  catch { return false; }
};

const neuLaden = async () => {
  await page.goto(`file://${WURZEL}/dashboard.html`);
  await page.waitForTimeout(300);
};
await neuLaden();

// ══════════════ OHNE ZWEI-FAKTOR AENDERT SICH NICHTS
try {
  await page.fill('#gName', 'adrian'); await page.fill('#gPass', 'richtig');
  const codeVorher = await page.evaluate(() =>
    getComputedStyle(document.getElementById('gate2fa')).display);
  await page.click('#gBtn');
  await warteDrin();
  await page.waitForTimeout(400);
  check('KRITISCH: wer keine Zwei-Faktor-Anmeldung hat, sieht das Codefeld nie',
    codeVorher === 'none');
  check('Die Anmeldung funktioniert wie vorher',
    await page.evaluate(() => !!localStorage.getItem('rv3_token')));
  check('Ohne Zwei-Faktor wird kein Geraet gemerkt',
    await page.evaluate(() => !localStorage.getItem('rv3_geraet_adrian')));
} catch (e) { check('Abschnitt ohne Abbruch durchgelaufen: ' + e.message, false); }

// ══════════════ EINRICHTEN
try {
  await page.evaluate(() => { try { go('betrieb'); bkAbschnittZeigen('zf'); } catch (e) {} });
  await page.waitForTimeout(500);
  check('Der Einschalter steht im Bereich Betrieb',
    (await page.textContent('#zfInhalt')).includes('Einrichten'));
  check('Es steht dabei, warum es das nur für die Verwaltung gibt',
    /Personalakte/.test(await page.textContent('#zfInhalt')));

  await page.click('#zfInhalt .btn-primary');
  await page.waitForTimeout(400);
  const e = await page.textContent('#zfInhalt');
  check('Der Schlüssel wird zum Abtippen angezeigt', /ABCD EFGH/.test(e));
  check('KRITISCH: es steht ausdrücklich da, dass noch nichts scharf ist',
    /noch ist nichts scharf/i.test(e));
  check('Man kann abbrechen, ohne etwas eingeschaltet zu haben', /Abbrechen/.test(e));

  // Falscher Code darf NICHT einschalten
  await page.fill('#zfCode', '999999');
  await page.click('#zfInhalt .btn-primary');
  await page.waitForTimeout(400);
  check('KRITISCH: ein falscher Code schaltet nichts ein',
    await page.evaluate(() => getComputedStyle(document.getElementById('zfErr')).display !== 'none'));
  check('Und der Hinweis nennt die wahrscheinlichste Ursache',
    /Uhrzeit/.test(await page.textContent('#zfErr')));
  check('Das Codefeld steht noch da -- man kann es gleich nochmal versuchen',
    await page.isVisible('#zfCode'));

  await page.fill('#zfCode', '123456');
  await page.click('#zfInhalt .btn-primary');
  await page.waitForTimeout(500);
  const n = await page.textContent('#zfInhalt');
  check('Nach dem richtigen Code ist es eingeschaltet', /Eingeschaltet/.test(n));
  check('KRITISCH: die Notfallcodes werden gezeigt', NOTFALL.every(c => n.includes(c)));
  check('KRITISCH: es steht dabei, dass es das einzige Mal ist',
    /einzige Mal/.test(n));
  check('Und was passiert, wenn sie weg sind', /Hostpoint/.test(n));
} catch (e) { check('Abschnitt ohne Abbruch durchgelaufen: ' + e.message, false); }

// ══════════════ ANMELDEN MIT CODE
try {
  geraete = [];
  await page.evaluate(() => { localStorage.clear(); });
  await neuLaden();
  await page.fill('#gName', 'adrian'); await page.fill('#gPass', 'richtig');
  await page.click('#gBtn');
  await page.waitForTimeout(500);
  const s = await page.evaluate(() => ({
    codefeld: getComputedStyle(document.getElementById('gate2fa')).display !== 'none',
    fehlerband: getComputedStyle(document.getElementById('gateErr')).display !== 'none',
    merkenText: document.getElementById('gMerkenText').textContent,
    drin: !!localStorage.getItem('rv3_token'),
  }));
  check('KRITISCH: der Code wird verlangt', s.codefeld);
  check('KRITISCH: das ist kein Fehler und wird auch nicht so gezeigt', !s.fehlerband);
  check('Der Haken nennt die 14 Tage, wie entschieden', /14 Tage/.test(s.merkenText));
  check('Ohne Code kommt niemand hinein', !s.drin);

  await page.fill('#gCode', '000000');
  await page.click('#gBtn');
  await page.waitForTimeout(400);
  check('KRITISCH: ein falscher Code lässt nicht hinein',
    await page.evaluate(() => !localStorage.getItem('rv3_token')));
  check('Und wird als Fehler gezeigt',
    /Code stimmt nicht/.test(await page.textContent('#gateErr')));

  await page.fill('#gCode', '123456');
  await page.click('#gBtn');
  await warteDrin();
  await page.waitForTimeout(300);
  check('Mit dem richtigen Code kommt man hinein',
    await page.evaluate(() => !!localStorage.getItem('rv3_token')));
  check('Ohne Haken wird kein Gerät gemerkt',
    await page.evaluate(() => !localStorage.getItem('rv3_geraet_adrian')));
} catch (e) { check('Abschnitt ohne Abbruch durchgelaufen: ' + e.message, false); }

// ══════════════ NOTFALLCODE
try {
  await page.evaluate(() => localStorage.clear());
  await neuLaden();
  await page.fill('#gName', 'adrian'); await page.fill('#gPass', 'richtig');
  await page.click('#gBtn'); await page.waitForTimeout(400);
  await page.fill('#gCode', NOTFALL[0]);
  await page.click('#gBtn');
  await warteDrin();
  await page.waitForTimeout(300);
  check('KRITISCH: ein Notfallcode kommt statt des Zeitcodes durch',
    await page.evaluate(() => !!localStorage.getItem('rv3_token')));
} catch (e) { check('Abschnitt ohne Abbruch durchgelaufen: ' + e.message, false); }

// ══════════════ GERAET MERKEN
try {
  await page.evaluate(() => localStorage.clear());
  await neuLaden();
  await page.fill('#gName', 'adrian'); await page.fill('#gPass', 'richtig');
  await page.click('#gBtn'); await page.waitForTimeout(400);
  await page.fill('#gCode', '123456');
  await page.check('#gMerken');
  await page.click('#gBtn');
  await warteDrin();
  await page.waitForTimeout(300);
  check('Mit Haken wird das Gerät gemerkt',
    await page.evaluate(() => localStorage.getItem('rv3_geraet_adrian') === 'GERAETEWERT'));

  // Naechste Anmeldung: kein Code mehr
  await page.evaluate(() => { localStorage.removeItem('rv3_token'); localStorage.removeItem('rv3_user'); });
  await neuLaden();
  await page.fill('#gName', 'adrian'); await page.fill('#gPass', 'richtig');
  await page.click('#gBtn');
  await warteDrin();
  await page.waitForTimeout(300);
  check('KRITISCH: auf dem gemerkten Gerät wird kein Code mehr verlangt',
    await page.evaluate(() => !!localStorage.getItem('rv3_token')));
  check('Das Merkmal wurde mitgeschickt', letzterLogin && letzterLogin.geraet === 'GERAETEWERT');

  // Ein anderer Login-Name darf das Merkmal NICHT erben
  await page.evaluate(() => { localStorage.removeItem('rv3_token'); localStorage.removeItem('rv3_user'); });
  await neuLaden();
  await page.fill('#gName', 'jemand.anderes'); await page.fill('#gPass', 'richtig');
  await page.click('#gBtn'); await page.waitForTimeout(400);
  check('KRITISCH: am selben Rechner ersetzt das Merkmal des einen nicht den Code des anderen',
    letzterLogin && !letzterLogin.geraet);
} catch (e) { check('Abschnitt ohne Abbruch durchgelaufen: ' + e.message, false); }

// ══════════════ VERWALTEN UND ABSCHALTEN
try {
  geraete = [{ id: 5, bezeichnung: 'Windows-Rechner', erstellt_am: '2026-08-21', letzte_nutzung: '2026-08-21' }];
  await page.evaluate(() => localStorage.clear());
  await neuLaden();
  await page.fill('#gName', 'adrian'); await page.fill('#gPass', 'richtig');
  await page.click('#gBtn'); await page.waitForTimeout(400);
  await page.fill('#gCode', '123456');
  await page.click('#gBtn'); await warteDrin();
  await page.evaluate(() => { try { go('betrieb'); bkAbschnittZeigen('zf'); } catch (e) {} });
  await page.waitForTimeout(500);
  const v = await page.textContent('#zfInhalt');
  check('Die gemerkten Geräte stehen in der Liste', /Windows-Rechner/.test(v));
  check('Die Zahl der übrigen Notfallcodes steht da', /9 von 10/.test(v));

  gesendet = null;
  await page.click('#zfInhalt button:has-text("vergessen")');
  await page.waitForTimeout(400);
  check('Ein Gerät lässt sich einzeln vergessen', gesendet && gesendet.id === 5);

  // Abschalten braucht das Passwort
  await page.waitForTimeout(300);
  gesendet = null;
  await page.click('#zfInhalt .btn-danger');
  await page.waitForTimeout(300);
  check('KRITISCH: ohne Passwort wird gar nicht erst gefragt',
    gesendet === null && !(await page.isVisible('#dlgConfirm.on')) && await page.isVisible('#zfErr'));
  // Falls die Pruefung oben scheitert, steht die Rueckfrage offen und wuerde
  // jeden weiteren Klick abfangen. Dann hier wegraeumen, damit der Rest der
  // Datei sauber weiterlaeuft statt in eine Zeitueberschreitung zu rennen.
  if (await page.isVisible('#dlgConfirm.on')) {
    await page.evaluate(() => closeDlg('dlgConfirm'));
    await page.waitForTimeout(200);
  }

  await page.fill('#zfAusPw', 'falsch');
  await page.click('#zfInhalt .btn-danger');
  await page.waitForSelector('#dlgConfirm.on');
  check('Abschalten fragt zuerst nach', await page.isVisible('#dlgConfirm.on'));
  await page.click('#cfBtn');
  await page.waitForTimeout(400);
  check('KRITISCH: mit falschem Passwort wird nicht abgeschaltet',
    zfAn === true && /Passwort falsch/.test(await page.textContent('#zfErr')));

  await page.fill('#zfAusPw', 'richtig');
  await page.click('#zfInhalt .btn-danger');
  await page.waitForSelector('#dlgConfirm.on');
  await page.click('#cfBtn');
  await page.waitForTimeout(500);
  check('Mit richtigem Passwort wird abgeschaltet', zfAn === false);
  check('Danach steht wieder der Einschalter da',
    /Einrichten/.test(await page.textContent('#zfInhalt')));
} catch (e) { check('Abschnitt ohne Abbruch durchgelaufen: ' + e.message, false); }

check('Kein JavaScript-Fehler auf dem ganzen Weg', jsFehler.length === 0);

console.log(`\n✓ ${ok.length} bestanden`);
if (bad.length) { console.log(`\n✗ ${bad.length} FEHLGESCHLAGEN:`); bad.forEach(b => console.log('  -', b)); }
if (jsFehler.length) { console.log('JS:', jsFehler); }
await browser.close();
process.exit(bad.length ? 1 : 0);
