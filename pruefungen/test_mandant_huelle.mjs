// Welchen Server die App anspricht (ENT-663, behebt OP-662).
//
// ANLASS: Die Serveradresse der nativen App stand FEST im Quelltext --
// `https://cupi24.guardops.ch/api/`, nirgends ersetzt. Die App im Store
// sprach ausschliesslich mit einem einzigen Mandanten. Das widerspricht
// ENT-661, wo der Projektinhaber festgelegt hat, dass die App allen
// Mandanten offensteht.
//
// WARUM ES DAS FELD BRAUCHT (die Frage war: "bei Coredinate klappt es
// von Beginn ueber die normale Anmeldemaske"): Unsere Betriebstabellen
// haben keine Mandantenspalte. `mitarbeiter` traegt id, name,
// password_hash -- kein mandant_id. Jeder Mandant hat eine eigene
// Datenbank. Ein Server kennt darum nur seine eigenen Leute und kann
// gar nicht sagen, ob ein Name zu einem anderen Betrieb gehoert; ein
// Name ist firmenuebergreifend auch nicht eindeutig. Die App muss die
// Adresse also VOR der ersten Anfrage kennen.
//
// Die schaerfste Pruefung hier ist nicht die Bequemlichkeit, sondern
// Abschnitt "FREMDE ADRESSE": Der eingegebene Wert wandert in eine URL.
// Ohne strenge Pruefung schickte die App Name und Passwort an einen
// beliebigen Server, den jemand ins Feld schreibt.
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const browser = await chromium.launch({ executablePath: browserPfad() });

/* Eine Seite in der HUELLE. Capacitor wird VOR dem Laden gesetzt --
   nativeAppHuelle() wird schon beim Auswerten des Skripts gebraucht
   (mandantUebernehmen laeuft dort). Wer es danach setzt, prueft eine
   Seite, die sich laengst fuer den Browser entschieden hat. */
async function huelle({ mandant = null, token = null, nativ = true } = {}) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const ziele = [];
  page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
  await page.addInitScript(([n, m, t]) => {
    if (n) {
      window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios' };
    }
    try {
      localStorage.clear();
      if (m) { localStorage.setItem('sop_mandant', m); }
      if (t) { localStorage.setItem('rv3_token', t); }
    } catch (e) {}
  }, [nativ, mandant, token]);
  // Jede Anfrage an einen Mandantenserver wird mitgeschrieben statt
  // beantwortet -- so steht fest, WOHIN die App spricht.
  await page.route('**/api/**', route => {
    ziele.push(route.request().url());
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', token: 't', name: 'm.muster', ist_admin: false }) });
  });
  await page.goto(`file://${WURZEL}/app.html`);
  await page.waitForTimeout(400);
  return { page, ziele };
}

/* Fragt die Seite nach dem Ergebnis von apiBasis(). Gibt es die Funktion
   nicht, kommt null zurueck -- NICHT ein Absturz. Genau daran ist die
   erste Fassung dieser Datei gescheitert: In der Gegenprobe (Funktion
   absichtlich entfernt) warf page.evaluate einen ReferenceError und riss
   die ganze Suite mit, statt die Pruefung rot zu faerben. Eine Gegenprobe,
   die abstuerzt statt rot zu werden, belegt gar nichts (OP-655). */
const basisVon = page => page.evaluate(() => {
  try { return typeof apiBasis === 'function' ? apiBasis() : null; }
  catch (e) { return null; }
});

const sichtbar = (page, sel) => page.evaluate(s => {
  const e = document.querySelector(s);
  return !!e && e.style.display !== 'none' && e.offsetParent !== null;
}, sel);

// ══════════ IM BROWSER GIBT ES NICHTS ZU WAEHLEN ══════════════════════
{
  const { page } = await huelle({ nativ: false });
  check('KRITISCH: im Browser erscheint kein Betriebsfeld -- dort entscheidet die Adresszeile',
    (await sichtbar(page, '#gMandantFeld')) === false);
  check('Und auch sonst keine Betriebszeile',
    (await page.$('#gMandantWechsel')) === null);
  check('Der API-Pfad bleibt im Browser relativ',
    (await page.evaluate(() => apiBasis())) === 'api/');
  await page.close();
}

// ══════════ FRISCHE INSTALLATION FRAGT ════════════════════════════════
{
  const { page, ziele } = await huelle({});
  check('KRITISCH: eine frische Installation in der Huelle fragt nach dem Betrieb',
    (await sichtbar(page, '#gMandantFeld')) === true);
  check('Ohne Betrieb gibt es keine Adresse -- und damit keine Anfrage ins Leere',
    (await page.evaluate(() => apiBasis())) === '');
  // Anmelden ohne Betrieb darf gar nicht erst senden.
  await page.fill('#gName', 'm.muster');
  await page.fill('#gPass', 'geheim');
  await page.click('#gBtn');
  await page.waitForTimeout(300);
  check('KRITISCH: ohne Betrieb wird NICHTS gesendet -- kein Name, kein Passwort',
    ziele.length === 0);
  check('Und die Maske sagt, was fehlt',
    (await page.textContent('#gErr')).includes('Betrieb'));
  await page.close();
}

// ══════════ FREMDE ADRESSE: DER GEFAEHRLICHE FALL ═════════════════════
/* Der eingegebene Wert wird Teil einer URL. Wer hier "boese.example/x"
   oder "cupi24.guardops.ch.boese.example" unterbringt, bekaeme Name und
   Passwort geschickt. Geprueft wird darum BEIDES: dass solche Eingaben
   abgewiesen werden, UND dass in dem Fall wirklich nichts hinausgeht. */
{
  const { page, ziele } = await huelle({});
  const boese = ['boese.example/x', 'cupi24.guardops.ch.boese.example',
                 'a.b', 'cupi24/../evil', 'CUPI24 ', '-start', '',
                 'cupi24?x=1', 'cupi24#x', 'cupi24:8080', '../../etc'];
  const abgewiesen = await page.evaluate(l => l.filter(m => !mandantGueltig(m)).length, boese);
  check('KRITISCH: jede dieser elf gefaehrlichen Eingaben wird als Betrieb abgewiesen',
    abgewiesen === boese.length);
  check('Und ein gewoehnlicher Kurzname wird angenommen',
    await page.evaluate(() => mandantGueltig('cupi24') && mandantGueltig('muster-ag')
      && mandantGueltig('a')));
  // Und zwar nicht nur in der Pruefung, sondern im ganzen Weg:
  await page.fill('#gMandant', 'boese.example/x');
  await page.fill('#gName', 'm.muster');
  await page.fill('#gPass', 'geheim');
  await page.click('#gBtn');
  await page.waitForTimeout(300);
  check('KRITISCH: mit einer fremden Adresse im Feld geht keine einzige Anfrage hinaus',
    ziele.length === 0);
  check('KRITISCH: und sie wird auch nicht gemerkt',
    (await page.evaluate(() => mandantGemerkt())) === '');
  await page.close();
}

// ══════════ DIE ADRESSE ENTSTEHT WIRKLICH AUS DEM BETRIEB ═════════════
{
  const { page, ziele } = await huelle({});
  await page.fill('#gMandant', 'musterag');
  await page.fill('#gName', 'm.muster');
  await page.fill('#gPass', 'geheim');
  await page.click('#gBtn');
  await page.waitForTimeout(500);
  check('KRITISCH: die Anmeldung geht an den Server des eingegebenen Betriebs',
    ziele.length > 0 && ziele[0].startsWith('https://musterag.guardops.ch/api/login.php'));
  check('KRITISCH: und nicht an den frueher fest verdrahteten',
    ziele.every(u => !u.includes('cupi24')));
  check('Der Betrieb ist danach gemerkt',
    (await page.evaluate(() => mandantGemerkt())) === 'musterag');
  await page.close();
}

// ══════════ BESTEHENDE INSTALLATION MERKT NICHTS ══════════════════════
/* Entscheidung des Projektinhabers: "Gemerkte Adresse bleibt, nichts
   aendert sich." Kennzeichen einer bestehenden Installation ist ein
   bereits liegendes Anmeldetoken -- eine frische hat keins. */
{
  const { page } = await huelle({ token: 'alt' });
  check('KRITISCH: eine bestehende Installation uebernimmt die bisherige Adresse still',
    (await page.evaluate(() => mandantGemerkt())) === 'cupi24');
  check('KRITISCH: und sieht darum kein Betriebsfeld',
    (await sichtbar(page, '#gMandantFeld')) === false);
  check('Die Adresse ist dieselbe wie vor der Aenderung',
    (await page.evaluate(() => apiBasis())) === 'https://cupi24.guardops.ch/api/');
  await page.close();
}

/* ══════════ WER SCHON GEWAEHLT HAT, SIEHT DAVON NICHTS MEHR ══════════
   Bis ENT-665 stand hier eine Dauerzeile "Betrieb: musterag -- aendern".
   Sie ist ersatzlos weg: Der Betrieb wird pro Geraet einmal gesetzt, und
   eine Einstellung, die man einmal im Leben braucht, gehoert nicht auf
   jeden Anmeldebildschirm.
   Der Rueckweg haengt damit ganz am Fehlerfall weiter unten -- darum
   steht hier zusaetzlich, dass es wirklich KEIN zweites Bauteil mehr
   gibt, das ihn tragen koennte. Waere diese Pruefung nur "unsichtbar",
   bliebe offen, ob da noch etwas Totes im Bildschirm haengt. */
{
  const { page } = await huelle({ mandant: 'musterag' });
  check('Mit gemerktem Betrieb ist das Feld weg',
    (await sichtbar(page, '#gMandantFeld')) === false);
  check('KRITISCH: und es steht auch keine Zeile zum Wechseln mehr da',
    (await page.$('#gMandantWechsel')) === null);
  check('KRITISCH: der gemerkte Betrieb wirkt trotzdem -- die Adresse zeigt auf ihn',
    (await page.evaluate(() => apiBasis())) === 'https://musterag.guardops.ch/api/');
  /* innerText, nicht textContent: textContent liest auch ausgeblendete
     Knoten mit -- und der Hinweistext des versteckten Feldes fuehrt
     "musterag" als Beispiel. Gefragt ist aber, was die Wachperson
     SIEHT. Die erste Fassung dieser Pruefung ist genau darueber
     gestolpert und hat einen Fehler gemeldet, den es nicht gab. */
  check('KRITISCH: auf dem Anmeldebildschirm ist vom Betrieb nichts mehr zu sehen',
    !(await page.innerText('#gate-login') || '').includes('musterag'));
  await page.close();
}

/* ══════════ BEIDE SEITEN SAGEN DASSELBE WORT ═════════════════════════
   Den Kurznamen traegt der Betreiber beim Mandanten ein und gibt ihn
   weiter; die Wachperson tippt ihn in die App. Stehen an den beiden
   Enden verschiedene Woerter -- frueher "Subdomain" hier, "Betrieb"
   dort --, sucht sie am Telefon etwas, das es unter dem Namen nicht
   gibt. Geprueft wird nicht der Wortlaut, sondern dass beide Enden
   denselben Begriff tragen: Wer eine Seite umbenennt, faellt auf. */
{
  const { page } = await huelle({});
  const appWort = await page.evaluate(() => w('betrieb'));
  await page.close();
  const seite = await browser.newPage();
  await seite.goto(`file://${WURZEL}/betreiber.html`);
  const label = (await seite.textContent('label[for="m-subdomain"]')) || '';
  const hinweis = (await seite.evaluate(() => {
    const e = document.querySelector('#m-subdomain');
    const h = e && e.parentElement.querySelector('.hinweis');
    return h ? h.textContent : '';
  })) || '';
  await seite.close();
  check('KRITISCH: die Betreiberseite beschriftet das Feld mit demselben Begriff wie die App',
    label.toLowerCase().includes(appWort.toLowerCase()));
  check('KRITISCH: und sie sagt, dass der Wert an den Mandanten weitergegeben wird',
    /weiter/i.test(hinweis));
  check('KRITISCH: sie sagt auch, dass die Leute des Mandanten ihn in die App eintragen',
    /app/i.test(hinweis));
  check('Das alte Technikwort steht dort nicht mehr allein als Beschriftung',
    label.trim().toLowerCase() !== 'subdomain');
}

// ══════════ KEINE ANTWORT IST NICHT DASSELBE WIE FALSCHES PASSWORT ════
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
  await page.addInitScript(() => {
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios' };
    try { localStorage.clear(); localStorage.setItem('sop_mandant', 'gibtsnicht'); } catch (e) {}
  });
  // Der Server antwortet gar nicht -- genau der Fall eines falsch
  // geschriebenen oder abgeschalteten Betriebs.
  await page.route('**/api/**', route => route.abort());
  await page.goto(`file://${WURZEL}/app.html`);
  await page.waitForTimeout(400);
  await page.fill('#gName', 'm.muster');
  await page.fill('#gPass', 'geheim');
  await page.click('#gBtn');
  await page.waitForTimeout(600);
  const meldung = (await page.textContent('#gErr')) || '';
  check('KRITISCH: bleibt die Antwort aus, nennt die Meldung den Betrieb',
    meldung.includes('gibtsnicht'));
  check('KRITISCH: und sie behauptet NICHT zu wissen, woran es liegt -- beide Moeglichkeiten stehen da',
    /nicht erreichbar/.test(meldung) && /antwortet/.test(meldung));
  check('KRITISCH: sie sagt insbesondere nicht "Name oder Passwort falsch"',
    !/Passwort falsch/.test(meldung));
  check('KRITISCH: und das Feld geht wieder auf, damit ein Vertipper zu beheben ist',
    (await sichtbar(page, '#gMandantFeld')) === true);
  await page.close();
}

/* ══════════ DAS COCKPIT IM SELBEN BUENDEL ════════════════════════════
   "Zum Cockpit" im Menue der App (nur fuer Verwaltung sichtbar) oeffnet
   dashboard.html aus DEMSELBEN Buendel. Bis ENT-669 stand dort dieselbe
   fest verdrahtete Adresse, die ENT-663 aus app.html entfernt hatte: Die
   App war halb mandantenfaehig -- Waechter-Ansicht richtig, Cockpit
   weiterhin auf CUPI 24. Ein Admin eines zweiten Mandanten haette sich
   richtig angemeldet und im Cockpit nur Fehler gesehen.

   Geprueft wird nicht, ob die Zeile im Quelltext anders aussieht,
   sondern WOHIN das Cockpit tatsaechlich spricht. */
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const ziele = [];
  /* "Failed to fetch" ist hier ERWARTET und kein Befund dieser Pruefung:
     api() in dashboard.html faengt einen Netzfehler nicht ab, die
     Zurueckweisung bleibt unbehandelt stehen. Das ist ein eigener,
     bestehender Mangel (OP-670) -- er gehoert nicht in diese Datei, und
     er darf sie auch nicht rot faerben. Jede ANDERE Fehlermeldung zaehlt
     weiterhin. */
  page.on('pageerror', e => {
    if (!/Failed to fetch/i.test(e.message)) { bad.push('JS-Fehler (Cockpit): ' + e.message); }
  });
  await page.addInitScript(() => {
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios' };
    try {
      localStorage.clear();
      localStorage.setItem('sop_mandant', 'musterag');
      localStorage.setItem('rv3_token', 'tok');
      // Ohne gemerkten Benutzer bleibt das Cockpit im Anmeldetor stehen
      // und fragt nichts ab -- dann pruefte der Abschnitt nichts.
      localStorage.setItem('rv3_user', JSON.stringify({
        id: 1, name: 'm.muster', ist_admin: true, rollen: ['verwaltung'] }));
    } catch (e) {}
  });
  /* Anfragen werden mitgeschrieben und ABGEBROCHEN, nicht beantwortet.
     Zwei Sackgassen liegen daneben, beide selbst hineingelaufen:
     Ein "ok" mit leerem Rumpf laesst das Cockpit ueber fehlende Felder
     stolpern -- ein Fehler meiner Attrappe, nicht der Sache. Und ein 401
     fuehrt dazu, dass das Cockpit die Seite VERLAESST; die Messung danach
     traf dann mal die alte, mal die neue Seite und war wackelig: dreimal
     hintereinander gelaufen, zweimal gruen, einmal rot. Eine wacklige
     Pruefung ist schlimmer als gar keine. Der Abbruch haelt die Seite
     stehen und beantwortet trotzdem genau die Frage: WOHIN spricht sie? */
  await page.route('**/*.php*', route => {
    ziele.push(route.request().url());
    route.abort();
  });
  await page.goto(`file://${WURZEL}/dashboard.html`);
  await page.waitForTimeout(1200);
  check('KRITISCH: das gebuendelte Cockpit spricht mit dem Server des gemerkten Betriebs',
    (await basisVon(page)) === 'https://musterag.guardops.ch/api/');
  check('KRITISCH: und nicht mehr mit der fest verdrahteten Adresse',
    ziele.every(u => !u.includes('cupi24.guardops.ch')));
  check('KRITISCH: es hat ueberhaupt gesprochen -- sonst pruefte die Zeile davor nichts',
    ziele.length > 0);
  check('KRITISCH: jede einzelne Anfrage ging an den gemerkten Betrieb',
    ziele.every(u => u.startsWith('https://musterag.guardops.ch/api/')));
  await page.close();
}

/* ══════════ OHNE BETRIEB SCHICKT DAS COCKPIT NICHTS ══════════════════
   Der Fall kann heute nicht eintreten -- wer im Cockpit landet, hat sich
   in app.html angemeldet und dabei den Betrieb gesetzt. Geprueft wird er
   trotzdem, weil die Folge sonst schweigend waere: eine Anfrage MIT
   Anmeldetoken an einen relativen Pfad unter capacitor://localhost. */
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const ziele = [];
  page.on('pageerror', e => bad.push('JS-Fehler (Cockpit ohne Betrieb): ' + e.message));
  await page.addInitScript(() => {
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios' };
    try { localStorage.clear(); localStorage.setItem('rv3_token', 'tok'); } catch (e) {}
  });
  await page.route('**/*.php*', route => { ziele.push(route.request().url()); route.abort(); });
  await page.goto(`file://${WURZEL}/dashboard.html`);
  await page.waitForTimeout(800);
  check('KRITISCH: ohne gemerkten Betrieb bleibt die Basis leer',
    (await basisVon(page)) === '');
  check('KRITISCH: und es geht keine einzige Anfrage samt Token hinaus',
    ziele.length === 0);
  check('Die Anfrage schlaegt ehrlich fehl, statt stillzuschweigen',
    (await page.evaluate(() => {
      try {
        return Promise.resolve(api('irgendwas.php'))
          .then(a => !!a && a.ok === false && a.status === 0, () => false);
      } catch (e) { return false; }
    })) === true);
  await page.close();
}

/* ══════════ FREMDE ADRESSE, ZWEITE TUER ═══════════════════════════════
   In app.html wird der gefaehrliche Wert EINGETIPPT und dort geprueft.
   Im Cockpit gibt es kein Feld -- der Wert kommt allein aus dem Speicher.
   Das macht die Pruefung nicht ueberfluessig, sondern verschiebt nur die
   Quelle: Wer an den Speicher kommt, kommt an beide Tueren. Ohne diese
   Pruefung baute das Cockpit aus jedem Speicherwert eine URL und schickte
   das Anmeldetoken dorthin.
   Gefunden, weil eine Gegenprobe (Pruefung durch "return !!m" ersetzt)
   GRUEN blieb -- die Regel stand da, aber nichts hielt sie fest. */
for (const boese of ['boese.example/x', 'cupi24.guardops.ch.boese.example',
                     'cupi24/../evil', 'cupi24:8080', '../../evil', 'CUPI24',
                     '-cupi24', 'cupi24@boese.example', 'a'.repeat(80),
                     'cupi24.boese.example', 'cupi24%2Eboese', 'cupi24?x=1']) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const ziele = [];
  page.on('pageerror', e => {
    if (!/Failed to fetch/i.test(e.message)) { bad.push('JS-Fehler (boese): ' + e.message); }
  });
  await page.addInitScript(m => {
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios' };
    try {
      localStorage.clear();
      localStorage.setItem('sop_mandant', m);
      localStorage.setItem('rv3_token', 'tok');
      localStorage.setItem('rv3_user', JSON.stringify({
        id: 1, name: 'm.muster', ist_admin: true, rollen: ['verwaltung'] }));
    } catch (e) {}
  }, boese);
  await page.route('**/*', route => {
    const u = route.request().url();
    if (!u.startsWith('file://')) { ziele.push(u); route.abort(); return; }
    route.continue();
  });
  await page.goto(`file://${WURZEL}/dashboard.html`);
  await page.waitForTimeout(700);
  check(`KRITISCH: das Cockpit baut aus »${boese.trim().slice(0, 24)}« keine Adresse`,
    (await basisVon(page)) === '');
  check(`KRITISCH: und schickt nichts dorthin -- auch nicht das Anmeldetoken`,
    ziele.length === 0);
  await page.close();
}

/* Umgebende Leerzeichen sind keine Gefahr, sondern ein Vertipper beim
   Abtippen. Sie werden getrimmt und NICHT abgewiesen -- sonst stuende
   jemand vor "Nur Kleinbuchstaben, Ziffern und Bindestriche", ohne den
   Unterschied sehen zu koennen. Stand faelschlich in der Liste oben und
   hat sie rot gefaerbt; hier steht jetzt, was wirklich gilt. */
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', e => {
    if (!/Failed to fetch/i.test(e.message)) { bad.push('JS-Fehler (Leerzeichen): ' + e.message); }
  });
  await page.addInitScript(() => {
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios' };
    try { localStorage.clear(); localStorage.setItem('sop_mandant', '  musterag  '); } catch (e) {}
  });
  await page.route('**/*.php*', route => route.abort());
  await page.goto(`file://${WURZEL}/dashboard.html`);
  await page.waitForTimeout(400);
  check('Umgebende Leerzeichen werden getrimmt, nicht abgewiesen',
    (await basisVon(page)) === 'https://musterag.guardops.ch/api/');
  await page.close();
}

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { console.log(bad.map(n => '  ✗ ' + n).join('\n')); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
