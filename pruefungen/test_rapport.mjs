// Rundgang-Detailansicht und Rapport-Export (ENT-322).
//
// Vom Projektinhaber verlangt: „Bitte die Dauer in der Spalte noch ergänzen.
// Zudem möchte ich, dass man den Rundgang anklicken kann und eine kleine
// Detailansicht gezeigt wird. […] Zudem möchte ich da ein Export-Button, um
// einen daraus generierten Rapport als PDF herunterzuladen, oder direkt per
// Mail zu versenden."
//
// Drei Dinge koennen hier still falsch werden, und um die geht es:
//
//  1. Die DAUER. Sie hat drei Quellen (ENT-321), und die falsche zu nehmen
//     faellt nicht auf: Es steht ja eine Zahl da. Gerechnet wird sie im
//     Server (pruef_rundgang.php prueft die Rechnung selbst) -- hier geht
//     es darum, dass die Liste sie ANZEIGT und dass „läuft" nicht wie eine
//     Dauer aussieht.
//  2. Der NACHWEIS. Ein nicht besuchter Kontrollpunkt muss im Rapport
//     stehen. Faellt er heraus, sieht eine halbe Runde aus wie eine ganze --
//     und zwar in der gefaehrlichen Richtung.
//  3. Der VERSAND. Betreff und Text formuliert der Server, nicht der
//     Aufrufer; sonst waere der Endpunkt ein Weg, ueber die Firmenadresse
//     beliebige Nachrichten zu verschicken.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);
const DASH = readFileSync(`${WURZEL}/dashboard.html`, 'utf8');
const MAILER = readFileSync(`${WURZEL}/backend/mailer.php`, 'utf8');
const VERSAND = readFileSync(`${WURZEL}/backend/api/rundgang_rapport_versenden.php`, 'utf8');
const DETAIL = readFileSync(`${WURZEL}/backend/api/rundgang_detail.php`, 'utf8');
const LISTE = readFileSync(`${WURZEL}/backend/api/rundgang_liste.php`, 'utf8');

// ══════════ SERVER: DIE DAUER KOMMT VON DORT ══════════════════════════
// Zwei Rechnungen an zwei Orten laufen auseinander -- die Oberflaeche darf
// die Endzeit nicht selbst zusammensuchen.
check('KRITISCH: die Liste liefert die Dauer fertig gerechnet mit',
  /rundgang_dauer\(/.test(LISTE));
check('KRITISCH: dafür kommt der letzte Scan aus der Datenbank mit',
  /MAX\(s\.erfasst_am\)[\s\S]{0,80}AS letzter_scan/.test(LISTE));
check('Die Detailansicht rechnet nach derselben Funktion',
  /rundgang_dauer\(/.test(DETAIL));

// ══════════ SERVER: DER VERSAND ═══════════════════════════════════════
check('KRITISCH: der Versand prüft ein Recht',
  /require_recht\(\$user, 'rundgang_einsehen'\)/.test(VERSAND));
check('KRITISCH: die Empfängeradresse wird serverseitig geprüft',
  /FILTER_VALIDATE_EMAIL/.test(VERSAND));
// Was der Client als Dateityp behauptet, laesst sich frei setzen -- was in
// der Datei steht, nicht (gleiches Prinzip wie ersatzscan_foto_mime()).
check('KRITISCH: der Anhang wird an den Magic Bytes geprüft, nicht an einer gemeldeten Endung',
  /str_starts_with\(\$pdf, '%PDF-'\)/.test(VERSAND));
check('KRITISCH: die Anhanggrösse ist begrenzt',
  /RAPPORT_PDF_MAX/.test(VERSAND) && /strlen\(\$pdf\) > RAPPORT_PDF_MAX/.test(VERSAND));
check('Base64 wird streng dekodiert, nicht stillschweigend zu Müll',
  /base64_decode\(\$pdfRoh, true\)/.test(VERSAND));
// Sonst waere dieser Endpunkt ein Weg, ueber die Firmenadresse beliebige
// Nachrichten zu verschicken.
check('KRITISCH: Betreff und Text kommen NICHT aus der Anfrage',
  !/\$in\['betreff'\]/.test(VERSAND) && !/\$in\['text'\]/.test(VERSAND)
  && /\$betreff = 'Rundgang-Rapport '/.test(VERSAND));
check('Ein unbekannter Rundgang wird abgewiesen', /'Rundgang nicht gefunden'/.test(VERSAND));
check('Fehlt die SMTP-Einrichtung, sagt der Endpunkt das, statt still zu scheitern',
  /!smtp_konfiguriert\(\)/.test(VERSAND));

// ══════════ SERVER: DER ANHANG IM MAILAUFBAU ══════════════════════════
// Ein Anhang ist kein zweiter Text, sondern ein zweiter Teil NEBEN der
// Nachricht. In einer multipart/alternative waere er fuer manche Programme
// eine dritte Textvariante und verschwaende still.
check('KRITISCH: mit Anhang wird die Nachricht als multipart/mixed gebaut',
  /multipart\/mixed; boundary=/.test(MAILER));
check('KRITISCH: die Text-/HTML-Auswahl bleibt darin als multipart/alternative erhalten',
  /multipart\/alternative; boundary="' \. \$grenze/.test(MAILER));
check('KRITISCH: ohne Anhang bleibt der Aufbau wie bisher — der Offert-Versand läuft produktiv',
  /if \(!\$anhaenge\) \{[\s\S]{0,260}multipart\/alternative/.test(MAILER));
check('Der Anhang wird als Anhang gekennzeichnet, nicht als Textteil',
  /Content-Disposition: attachment; filename=/.test(MAILER));
check('Ein Dateiname mit Umlaut wird kodiert, statt die Nachricht unzustellbar zu machen',
  /\$dateiname = smtp_kopf_kodieren\(/.test(MAILER));
check('Die äussere und die innere Grenze sind verschieden — sonst endet die Nachricht zu früh',
  /\$aussen = 'sop-mix-'/.test(MAILER));

// ══════════ DIE OBERFLÄCHE ════════════════════════════════════════════
const heute = new Date().toISOString().slice(0, 10);
const RUNDGAENGE = { status: 'ok', rundgaenge: [
  // Abgeschlossen, mit Server-Endzeit.
  { id: 41, status: 'abgeschlossen', datum: heute, kunde_name: 'Musterliegenschaften AG',
    objekt_name: 'Musterobjekt', titel: 'Schliessrunde', vorname: 'Max', nachname: 'Muster',
    rohzeit_start: heute + ' 22:00:00', rohzeit_ende: heute + ' 23:14:00', pause_minuten: 0,
    letzter_scan: heute + ' 23:10:00',
    dauer: { sekunden: 4440, quelle: 'rohzeit_ende' },
    fortschritt: { gesamt: 3, bestaetigt: 2, nicht_verfuegbar: 1, ersatzscan: 0 } },
  // Laufend -- „läuft" ist keine Dauer und darf nicht wie eine aussehen.
  { id: 42, status: 'laeuft', datum: heute, kunde_name: 'Musterliegenschaften AG',
    objekt_name: 'Zweitobjekt', titel: null, vorname: 'Eva', nachname: 'Beispiel',
    rohzeit_start: heute + ' 23:30:00', rohzeit_ende: null, pause_minuten: 0,
    letzter_scan: null, dauer: { sekunden: null, quelle: 'laeuft' },
    fortschritt: { gesamt: 2, bestaetigt: 0, nicht_verfuegbar: 0, ersatzscan: 0 } },
  // Beendet, aber ohne jede Zeitangabe -- „–" und nicht „0:00".
  { id: 43, status: 'abgebrochen', datum: heute, kunde_name: 'Musterliegenschaften AG',
    objekt_name: 'Drittobjekt', titel: null, vorname: 'Urs', nachname: 'Test',
    rohzeit_start: null, rohzeit_ende: null, pause_minuten: 0,
    letzter_scan: null, dauer: { sekunden: null, quelle: 'unbekannt' },
    fortschritt: { gesamt: 1, bestaetigt: 0, nicht_verfuegbar: 0, ersatzscan: 0 } },
]};

const DETAIL41 = { status: 'ok', rundgang: {
  id: 41, status: 'abgeschlossen', datum: heute,
  kunde_name: 'Musterliegenschaften AG', kunde_email: 'empfang@musterliegenschaften.example',
  objekt_name: 'Musterobjekt', strasse: 'Musterweg 4', ort: '9999 Musterdorf',
  titel: 'Schliessrunde', vorlage_name: 'Schlusskontrolle',
  vorname: 'Max', nachname: 'Muster',
  rohzeit_start: heute + ' 22:00:00', rohzeit_ende: heute + ' 23:14:00',
  letzter_scan: heute + ' 23:10:00', pause_minuten: 12,
  abbruch_grund: null, abbruch_freitext: null,
  dauer: { sekunden: 3720, quelle: 'rohzeit_ende' },
  fortschritt: { gesamt: 3, bestaetigt: 1, nicht_verfuegbar: 1, ersatzscan: 0 },
  kontrollpunkte: [
    { id: 1, bezeichnung: 'Haupteingang', reihenfolge: 1, typ: 'geofence',
      erledigt: { status: 'bestaetigt', erfasst_am: heute + ' 22:07:00',
        uebermittelt_am: heute + ' 22:07:30', beschreibung: null, hat_foto: false },
      aufgaben: [
        { id: 5, bezeichnung: 'Türe verschlossen?', information: null,
          erledigt: { status: 'erledigt', grund: null, erfasst_am: heute + ' 22:07:20' } },
        { id: 6, bezeichnung: 'Licht löschen', information: null, erledigt: null },
      ] },
    { id: 2, bezeichnung: 'Tor Nord', reihenfolge: 2, typ: 'geofence',
      erledigt: { status: 'nicht_verfuegbar', erfasst_am: heute + ' 22:41:00',
        uebermittelt_am: heute + ' 22:41:10', beschreibung: 'Baustelle, kein Durchgang',
        hat_foto: true },
      aufgaben: [] },
    // Der wichtige Fall: nie besucht. Er MUSS in der Liste stehen.
    { id: 3, bezeichnung: 'Kellerabgang', reihenfolge: 3, typ: 'geofence',
      erledigt: null, aufgaben: [] },
  ],
  ereignisse: [
    { id: 77, erfasst_am: heute + ' 22:55:00', vorfall_am: null,
      bemerkung: 'Scheibe beschädigt', hat_foto: true, art: 'Sachbeschädigung' },
  ],
} };

const gerufen = [];
let versandKoerper = null;
const browser = await chromium.launch({ executablePath: browserPfad() });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
await page.route('**/api/**', r => {
  const p = r.request().url().split('/api/')[1].split('?')[0];
  gerufen.push(p);
  const send = b => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'a', ist_admin: true });
  if (p.includes('rundgang_detail')) return send(DETAIL41);
  if (p.includes('rundgang_liste')) return send(RUNDGAENGE);
  if (p.includes('rundgang_spur')) return send({ status: 'ok', punkte: [], eingerichtet: true });
  if (p.includes('rundgang_rapport_versenden')) {
    versandKoerper = JSON.parse(r.request().postData() || '{}');
    return send({ status: 'ok', empfaenger: versandKoerper.empfaenger, dateiname: 'x.pdf' });
  }
  if (p.includes('revierdienst_status')) return send({ status: 'ok', eingeteilt: 0, aktiv: 0, leute: [] });
  if (p.includes('dashboard_stats')) return send({ status: 'ok', kpi: {}, verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [] });
  return send({ status: 'ok', mitarbeiter: [], kunden: [], einsaetze: [], objekte: [], rapporte: [], rundgaenge: [] });
});
await page.route('**maps.googleapis.com/**', route => route.abort());
// html2pdf ist 946 KB und wird hier nicht gebraucht: Geprueft wird, DASS
// erst beim Klick geladen wird, nicht die Bibliothek selbst.
await page.route('**html2pdf.bundle.min.js', route =>
  route.fulfill({ status: 200, contentType: 'application/javascript',
    body: 'window.html2pdf = function(){ return { set(){return this;}, from(){return this;},'
      + ' outputPdf(){ return Promise.resolve(new Blob(["%PDF-1.4 test"],{type:"application/pdf"})); } }; };' }));

await page.goto(`file://${WURZEL}/dashboard.html`);
await page.evaluate(() => localStorage.clear());
await page.goto(`file://${WURZEL}/dashboard.html`);
await page.fill('#gName', 'a'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#shell.on');
await page.evaluate(() => go('rundgaenge'));
await page.waitForTimeout(700);

// ══════════ DIE SPALTE „DAUER" ═══════════════════════════════════════
const kopf = await page.evaluate(() =>
  [...document.querySelectorAll('#rdLetzteListe thead th')].map(t => t.textContent.trim()));
check('KRITISCH: die Liste hat eine Spalte "Dauer"', kopf.includes('Dauer'));
const spalte = kopf.indexOf('Dauer');
const zellen = await page.evaluate(i =>
  [...document.querySelectorAll('#rdLetzteListe tbody tr')].map(z =>
    z.children[i] ? z.children[i].textContent.trim() : null), spalte);
check('KRITISCH: eine abgeschlossene Runde zeigt ihre Dauer', zellen[0] === '1:14 h');
// „läuft" ist keine Zahl und bekommt darum keine Einheit -- „läuft h" waere
// Unsinn, und eine 0 waere schlicht falsch.
check('KRITISCH: eine laufende Runde zeigt "läuft", nicht 0:00', zellen[1] === 'läuft');
check('Und trägt keine Einheit hinter sich', !String(zellen[1]).includes('h'));
// Unbekannt darf nie wie keine aussehen -- und schon gar nicht wie null.
check('KRITISCH: eine Runde ohne Zeitangaben zeigt "–", nicht 0:00', zellen[2] === '–');

// ══════════ DIE ZEILE IST ANKLICKBAR ══════════════════════════════════
check('Die Zeilen sind als anklickbar gekennzeichnet',
  await page.evaluate(() => document.querySelectorAll('#rdLetzteListe tr.klickbar').length === 3));
// Eine Zeile, die nur die Maus oeffnen kann, ist fuer die Tastatur eine
// Sackgasse.
check('KRITISCH: sie sind auch mit der Tastatur erreichbar',
  await page.evaluate(() =>
    [...document.querySelectorAll('#rdLetzteListe tr.klickbar')].every(z => z.tabIndex === 0)));

await page.click('#rdLetzteListe tbody tr:first-child');
await page.waitForTimeout(600);
check('KRITISCH: der Klick öffnet die Detailansicht',
  await page.evaluate(() => document.getElementById('dlgRundgang').classList.contains('on')));
check('Sie fragt den Detail-Endpunkt ab', gerufen.some(p => p.includes('rundgang_detail')));
// Datensparsamkeit aus ENT-318: Der Weg kommt erst auf Knopfdruck.
check('KRITISCH: der Weg wird dabei NICHT mitgeladen',
  !gerufen.some(p => p.includes('rundgang_spur')));

// ══════════ DER INHALT DER DETAILANSICHT ══════════════════════════════
const kopfText = await page.textContent('#rgdUnter');
check('Der Kopf nennt Kunde, Kontrollrunde, Datum und Person',
  kopfText.includes('Musterliegenschaften AG') && kopfText.includes('Schlusskontrolle')
  && kopfText.includes('Max Muster'));
check('Der Status steht als eigenes Merkmal da',
  (await page.textContent('#rgdStatus')).trim() === 'Abgeschlossen');

const band = await page.evaluate(() => [...document.querySelectorAll('.rgd-band > div')].map(d => ({
  l: d.querySelector('.l').textContent.trim(),
  v: d.querySelector('.v').textContent.trim(),
  f: d.querySelector('.f') ? d.querySelector('.f').textContent.trim() : '',
  lOben: d.querySelector('.l').getBoundingClientRect().top < d.querySelector('.v').getBoundingClientRect().top,
  lGroesse: parseFloat(getComputedStyle(d.querySelector('.l')).fontSize),
  vGroesse: parseFloat(getComputedStyle(d.querySelector('.v')).fontSize),
})));
check('Das Kennzahlenband hat vier Blöcke', band.length === 4);
// Hausregel: Ueberschrift oben, Wert darunter -- und zwar in ALLEN
// Bloecken, nicht nur im ersten. Gemessen am gerenderten Zustand, nicht im
// Quelltext nachgelesen.
check('KRITISCH: in jedem Block steht die Beschriftung ÜBER dem Wert',
  band.length === 4 && band.every(b => b.lOben));
check('KRITISCH: alle vier Blöcke benutzen dieselben Schriftgrössen',
  band.length === 4 && band.every(b => b.lGroesse === band[0].lGroesse && b.vGroesse === band[0].vGroesse));
check('Die Beschriftung ist feiner als der Wert', band[0].lGroesse < band[0].vGroesse);
check('KRITISCH: die Dauer steht im Band', band.some(b => b.l === 'Dauer' && b.v.startsWith('1:02')));
check('Die abgezogene Pause wird ausgewiesen, nicht verschwiegen',
  band.some(b => b.l === 'Dauer' && b.f.includes('12') && b.f.includes('Pause')));
// Zwei Einheiten nie unter einer Ueberschrift: „1" allein saehe aus wie die
// Gesamtzahl.
check('KRITISCH: die Kontrollpunkte stehen als "1 / 3", nicht als nackte Zahl',
  band.some(b => b.l === 'Kontrollpunkte' && b.v.replace(/\s/g, '') === '1/3'));

const zeilenTexte = await page.evaluate(() =>
  [...document.querySelectorAll('.rgd-zeile')].map(z => ({
    zeit: z.querySelector('.zeit').textContent.trim(),
    name: z.querySelector('.name').textContent.trim(),
    offen: z.classList.contains('offen'),
  })));
check('KRITISCH: alle drei Kontrollpunkte stehen im Verlauf', zeilenTexte.length === 3);
// Der Kern des Nachweises: Ein nicht besuchter Punkt darf nicht
// herausfallen, sonst sieht eine halbe Runde aus wie eine ganze.
check('KRITISCH: der NICHT besuchte Punkt steht in der Liste',
  zeilenTexte.some(z => z.name.includes('Kellerabgang')));
check('KRITISCH: und ist als "Nicht besucht" gekennzeichnet, nicht als leere Zeile',
  zeilenTexte.some(z => z.name.includes('Kellerabgang') && z.name.includes('Nicht besucht') && z.offen));
// Ueber eine Hilfsfunktion und nicht direkt per .find().zeit: Faellt eine
// Zeile weg, soll die Suite SAGEN, welche Aussage nicht mehr stimmt, statt
// mit einem TypeError abzustuerzen. Beim Gegenprobieren aufgefallen -- eine
// abgestuerzte Suite nennt die Ursache nicht.
const zeitVon = t => (zeilenTexte.find(z => z.name.includes(t)) || {}).zeit;
check('Er trägt keine erfundene Uhrzeit', zeitVon('Kellerabgang') === '–');
check('Ein bestätigter Punkt trägt seine Uhrzeit', zeitVon('Haupteingang') === '22:07');
check('Ein nicht verfügbarer Punkt ist als solcher gekennzeichnet',
  zeilenTexte.some(z => z.name.includes('Tor Nord') && z.name.includes('Nicht verfügbar')));

const koerper = await page.textContent('#rgdBody');
check('Die Bemerkung des Wächters steht dabei', koerper.includes('Baustelle, kein Durchgang'));
check('Eine beantwortete Aufgabe steht beim Punkt', koerper.includes('Türe verschlossen?'));
// ENT-311: Eine nicht beantwortete Aufgabe ist genau das Fehlen eines
// Eintrags -- sie muss trotzdem auffallen.
check('KRITISCH: eine UNBEANTWORTETE Aufgabe fällt auf, statt zu fehlen',
  koerper.includes('Licht löschen') && koerper.includes('Unbeantwortet'));
check('Die Ereignisse der Runde stehen dabei', koerper.includes('Sachbeschädigung'));
await page.screenshot({ path: `${OUT}/rapport-01-detail.png` });

// ══════════ GESTALTUNG, GEMESSEN ══════════════════════════════════════
check('KRITISCH: kein waagrechter Seiten-Scroll am Desktop',
  await page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
check('KRITISCH: auch auf dem Handy kein waagrechter Seiten-Scroll',
  await page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
// Auf 390 px stuenden vier Bloecke nebeneinander als vier Streifen da.
check('Auf dem Handy bricht das Kennzahlenband auf zwei Spalten um',
  await page.evaluate(() => {
    const d = [...document.querySelectorAll('.rgd-band > div')];
    return d.length === 4 && d[0].getBoundingClientRect().top === d[1].getBoundingClientRect().top
      && d[2].getBoundingClientRect().top > d[0].getBoundingClientRect().top;
  }));
check('Die Knöpfe sind auf dem Handy gross genug zum Treffen',
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('#dlgRundgang .dlg-ft .btn')];
    return b.length >= 3 && b.every(x => x.getBoundingClientRect().height >= 36);
  }));
await page.screenshot({ path: `${OUT}/rapport-02-handy.png` });
await page.setViewportSize({ width: 1440, height: 1000 });
await page.waitForTimeout(300);

// ══════════ DAS RAPPORTBLATT ══════════════════════════════════════════
// html2pdf rastert das GERENDERTE Element -- ein display:none-Element hat
// keine Masse und ergaebe eine leere Seite.
check('KRITISCH: das Rapportblatt ist gerendert, nicht per display:none versteckt',
  await page.evaluate(() => {
    const b = document.getElementById('rapportBlatt');
    return getComputedStyle(b).display !== 'none' && b.getBoundingClientRect().width > 300;
  }));
check('Es liegt ausserhalb des sichtbaren Bereichs',
  await page.evaluate(() => document.getElementById('rapportBlatt').getBoundingClientRect().right < 0));

const blatt = await page.evaluate(() => { rapportBlattFuellen(rgdDaten); return document.getElementById('rapportBlatt').innerText; });
check('Der Rapport nennt Kunde und Objekt',
  blatt.includes('Musterliegenschaften AG') && blatt.includes('Musterobjekt'));
check('Er nennt die Adresse des Objekts', blatt.includes('Musterweg 4'));
check('Er nennt die Kontrollrunde, nicht nur das Objekt', blatt.includes('Schlusskontrolle'));
check('Er nennt den Mitarbeitenden', blatt.includes('Max Muster'));
check('KRITISCH: er nennt die Dauer', blatt.includes('1:02'));
check('Und weist die abgezogene Pause aus', blatt.includes('12') && blatt.includes('Pause'));
check('KRITISCH: der nicht besuchte Punkt steht auch im Rapport',
  blatt.includes('Kellerabgang') && blatt.includes('Nicht besucht'));
check('Die unbeantwortete Aufgabe steht auch im Rapport',
  blatt.includes('Licht löschen') && blatt.includes('Unbeantwortet'));
check('Das Ereignis steht im Rapport', blatt.includes('Sachbeschädigung'));
// Der Entscheid des Projektinhabers zu ENT-322: keine Karte im Rapport.
check('KRITISCH: der Rapport enthält keine Karte',
  await page.evaluate(() => !document.querySelector('#rapportBlatt img, #rapportBlatt canvas, #rapportBlatt iframe')));
// „Keine Ereignisse" ist eine Aussage, ein fehlender Abschnitt keine.
const leer = await page.evaluate(() => {
  const kopie = JSON.parse(JSON.stringify(rgdDaten));
  kopie.ereignisse = [];
  rapportBlattFuellen(kopie);
  const t = document.getElementById('rapportBlatt').innerText;
  rapportBlattFuellen(rgdDaten);
  return t;
});
// Kleingeschrieben verglichen: innerText wendet text-transform an, und die
// Abschnittsueberschriften stehen versal. Der erste Anlauf scheiterte genau
// daran -- der Text war da, nur in Grossbuchstaben.
check('KRITISCH: ohne Ereignisse steht das ausdrücklich da, statt dass der Abschnitt fehlt',
  leer.toLowerCase().includes('ereignisse') && leer.includes('kein Ereignis gemeldet'));

// ══════════ PDF: ERST BEIM KLICK GELADEN ══════════════════════════════
check('KRITISCH: html2pdf steht NICHT als Skript-Tag im Kopf — 946 KB für jede Sitzung',
  !/<script[^>]+html2pdf/.test(DASH));
check('Vor dem Klick ist die Bibliothek nicht geladen',
  await page.evaluate(() => typeof html2pdf === 'undefined'));
await page.evaluate(() => { window.__dl = null;
  const echt = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { window.__dl = this.download; };
  window.__echtClick = echt;
});
await page.click('#rgdPdfBtn');
await page.waitForTimeout(900);
check('KRITISCH: nach dem Klick ist sie da', await page.evaluate(() => typeof html2pdf === 'function'));
const dateiname = await page.evaluate(() => window.__dl);
check('KRITISCH: eine Datei wird zum Herunterladen angeboten', !!dateiname);
// Ein Rapport, der „download.pdf" heisst, ist im Ordner des Kunden nicht
// wiederzufinden.
check('Sie trägt Objekt und Datum im Namen',
  String(dateiname).includes('Musterobjekt') && String(dateiname).includes(heute)
  && String(dateiname).endsWith('.pdf'));
check('Der Knopf ist danach wieder bedienbar',
  await page.evaluate(() => !document.getElementById('rgdPdfBtn').disabled));

// ══════════ VERSAND PER E-MAIL ════════════════════════════════════════
await page.click('#rgdMailBtn');
await page.waitForTimeout(300);
check('KRITISCH: der Versand fragt nach einem Empfänger',
  await page.evaluate(() => document.getElementById('dlgRapportMail').classList.contains('on')));
check('Die hinterlegte Kundenadresse ist vorbelegt',
  await page.inputValue('#rmEmpfaenger') === 'empfang@musterliegenschaften.example');
// Eine Adresse ohne @ ergibt beim Server einen Fehler -- der Weg dorthin
// dauert aber, und der Rapport waere umsonst erzeugt.
await page.fill('#rmEmpfaenger', 'keine-adresse');
await page.click('#rmBtn');
await page.waitForTimeout(300);
check('KRITISCH: eine unbrauchbare Adresse wird sofort beanstandet',
  await page.isVisible('#rmErr'));
check('Und es wird nichts versendet', versandKoerper === null);

await page.fill('#rmEmpfaenger', 'leitung@example.ch');
await page.click('#rmBtn');
await page.waitForTimeout(1200);
check('KRITISCH: der Rapport wird versendet', versandKoerper !== null);
check('KRITISCH: das PDF geht als Anhang mit, nicht nur ein Verweis',
  !!versandKoerper && typeof versandKoerper.pdf === 'string' && versandKoerper.pdf.length > 0);
check('KRITISCH: der Anhang ist wirklich ein PDF',
  !!versandKoerper && atob(versandKoerper.pdf.slice(0, 12)).startsWith('%PDF-'));
check('Die Runde wird mitgeschickt, damit der Server den Betreff selbst bildet',
  !!versandKoerper && Number(versandKoerper.rundgang_id) === 41);
check('KRITISCH: der Aufrufer schickt weder Betreff noch Text mit',
  !!versandKoerper && versandKoerper.betreff === undefined && versandKoerper.text === undefined);
check('Das Fenster schliesst sich nach dem Versand',
  await page.evaluate(() => !document.getElementById('dlgRapportMail').classList.contains('on')));

// ══════════ ABLAGE: AUSWERTUNG → RUNDGANGERLEDIGUNG ══════════════════
// Die Frage des Projektinhabers war, WO durchgeführte Rundgänge dauerhaft
// auffindbar sein sollen. Der Ort existierte bereits: der Reiter
// „Rundgangerledigung" unter Arbeitsergebnisse. Er ist der einzige mit
// einem freien Zeitraum und reicht damit weiter zurück als die 14 Tage der
// Revierdienst-Hauptseite. Geprüft wird, dass er in DIESELBE Detailansicht
// führt -- eine zweite wäre genau die Doppelung, die hier vermieden wurde.
await page.evaluate(() => rgdZu());
// Seit ENT-325 ist das eine eigene Ansicht, keine Schublade -- über go(),
// sonst bliebe der Bereich verborgen und die Karten wären nicht anklickbar.
await page.evaluate(() => { go('arbeitsergebnisse'); aeGoTab('erledigung'); });
await page.waitForTimeout(600);
const erlKarten = await page.evaluate(() =>
  [...document.querySelectorAll('#aeErlListe .ag-karte')].map(k => ({
    text: k.innerText,
    klickbar: k.classList.contains('klickbar'),
    tab: k.tabIndex,
  })));
check('KRITISCH: der Reiter listet die durchgeführten Rundgänge', erlKarten.length === 3);
check('KRITISCH: die Dauer steht auch hier', erlKarten[0] && erlKarten[0].text.includes('1:14 h'));
check('Eine laufende Runde zeigt auch hier "läuft" statt einer Zahl',
  erlKarten[1] && erlKarten[1].text.includes('läuft') && !erlKarten[1].text.includes('0:00'));
// Eine Runde ohne Zeitangaben bekommt gar keine Dauerangabe statt eines
// nackten Gedankenstrichs mitten in der Zeile.
check('Eine Runde ohne Zeitangaben trägt hier keine leere Dauer mit sich herum',
  erlKarten[2] && !erlKarten[2].text.includes('– h'));
check('KRITISCH: die Karten sind anklickbar und mit der Tastatur erreichbar',
  erlKarten.length === 3 && erlKarten.every(k => k.klickbar && k.tab === 0));
check('Dass sie anklickbar sind, ist auch zu sehen und nicht nur zu ahnen',
  await page.evaluate(() => {
    const k = document.querySelector('#aeErlListe .ag-karte');
    return k && getComputedStyle(k).cursor === 'pointer';
  }));
await page.click('#aeErlListe .ag-karte');
await page.waitForTimeout(600);
check('KRITISCH: der Klick führt in DIESELBE Detailansicht, nicht in eine zweite',
  await page.evaluate(() => document.getElementById('dlgRundgang').classList.contains('on')));
await page.screenshot({ path: `${OUT}/rapport-03-erledigung.png` });

// ══════════ DAS BLATT IM HAUSSTIL ════════════════════════════════════
// Es gibt in diesem Haus EIN Rapportblatt-Aussehen (epBerichtBlatt, ENT-169).
// Ein Rundgang-Rapport ist keine neue Gattung -- geprüft an den Merkmalen,
// die den Hausstil ausmachen, nicht am Wortlaut.
// Ausdrücklich im DUNKLEN Thema gemessen -- der Projektinhaber arbeitet
// darin (siehe seine Bildschirmfotos). Im hellen Thema wäre die Prüfung
// wertlos: Dort sind var(--surface)/var(--ink) zufällig dieselben Werte wie
// Weiss und Schwarz, ein Blatt, das das Thema erbt, fiele nicht auf.
await page.evaluate(() => document.documentElement.setAttribute('data-thema', 'dunkel'));
await page.evaluate(() => rapportBlattFuellen(rgdDaten));
const stil = await page.evaluate(() => {
  const b = document.getElementById('rapportBlatt');
  // Über den Textinhalt gesucht statt über die Baumstellung: Die Blätter des
  // Hauses tragen ihre Gestaltung als Inline-Stil und haben keine Klassen,
  // an denen sich greifen liesse -- und eine Suche über "div > div" prüfte
  // die Verschachtelung mit, nicht das gesuchte Merkmal.
  const titel = [...b.querySelectorAll('div')].find(x => x.textContent.trim() === 'Rundgang-Rapport');
  const kopf = titel ? titel.closest('div[style*="border-bottom"]') : null;
  return {
    titel: titel ? titel.textContent.trim() : null,
    titelGroesse: titel ? parseFloat(getComputedStyle(titel).fontSize) : 0,
    kopfLinie: kopf ? getComputedStyle(kopf).borderBottomWidth : null,
    weiss: getComputedStyle(b).backgroundColor,
    tinte: getComputedStyle(b).color,
    tabellen: b.querySelectorAll('table').length,
  };
});
check('Das Blatt trägt den Titel oben links wie der Kundenrapport',
  stil.titel === 'Rundgang-Rapport' && stil.titelGroesse >= 20);
check('Mit derselben kräftigen Trennlinie unter dem Kopf', stil.kopfLinie === '2px');
// Ein Dokument ist immer hell -- auch wenn das Dashboard gerade dunkel ist.
check('KRITISCH: das Blatt ist hell, unabhängig vom Thema des Dashboards',
  stil.weiss === 'rgb(255, 255, 255)' && stil.tinte === 'rgb(20, 22, 26)');
check('Kopfangaben, Kontrollpunkte und Ereignisse stehen in eigenen Tabellen',
  stil.tabellen === 3);
await page.screenshot({ path: `${OUT}/rapport-04-blatt-dunkel.png` });
await page.evaluate(() => document.documentElement.removeAttribute('data-thema'));
// Die Fusszeile wird GETEILT, nicht nachgebaut -- sonst veraltet dieselbe
// Adresse an zwei Orten verschieden.
check('KRITISCH: die Fusszeile kommt aus der gemeinsamen Stelle des Hauses',
  /\$\('rapportBlatt'\)\.innerHTML[\s\S]{0,4000}\$\{bkFusszeile\(\)\}/.test(DASH));
check('Der Briefkopf des Betriebs wird verwendet, keine erfundene Absenderzeile',
  /function rapportBlattFuellen[\s\S]{0,1200}briefkopf\.logo/.test(DASH)
  && /function rapportBlattFuellen[\s\S]{0,1400}briefkopf\.firma/.test(DASH));

// ══════════ DAS PDF IST WIRKLICH NICHT LEER ══════════════════════════
// Diese Prüfung gibt es, weil genau das schiefging: Alle 80 übrigen
// Prüfungen waren grün, und das heruntergeladene PDF war trotzdem leer.
// Der Grund ist eine Eigenheit von html2pdf, die sich in keinem Quelltext
// ablesen lässt: Es klont das übergebene Element MITSAMT SEINER id in einen
// eigenen Behälter. Trug das Blatt selbst `position:absolute;left:-10000px`,
// galt die Regel im Klon weiter, html2canvas mass eine Höhe von 0 und
// erzeugte eine weisse Seite.
//
// Ein Quelltext-Test hätte das nie gefunden. Darum läuft hier die ECHTE
// Bibliothek gegen das ECHTE Blatt, und gemessen wird das Ergebnis: Höhe
// des gerasterten Bildes und Anteil nicht-weisser Bildpunkte.
await page.unroute('**html2pdf.bundle.min.js');
await page.addScriptTag({ path: `${WURZEL}/html2pdf.bundle.min.js` });
const bild = await page.evaluate(async () => {
  try {
    rapportBlattFuellen(rgdDaten);
    const c = await html2pdf().set({ margin: 10, html2canvas: { scale: 2 },
      jsPDF: { unit: 'mm', format: 'a4' } }).from(document.getElementById('rapportBlatt'))
      .toCanvas().get('canvas');
    if (!c.width || !c.height) { return { w: c.width, h: c.height, anteil: 0 }; }
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let dunkel = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] < 200 || d[i + 1] < 200 || d[i + 2] < 200) { dunkel++; }
    }
    return { w: c.width, h: c.height, anteil: dunkel / (d.length / 4) * 100 };
  } catch (e) { return { fehler: String(e) }; }
});
check('KRITISCH: das Rapportblatt hat im Klon überhaupt eine Höhe — genau hier war das PDF leer',
  !bild.fehler && bild.h > 400);
check('KRITISCH: die gerasterte Seite ist nicht weiss, es steht wirklich etwas darauf',
  !bild.fehler && bild.anteil > 0.5);
check('Sie ist so breit wie das Blatt, nicht auf einen Streifen zusammengefallen',
  !bild.fehler && bild.w > 1000);

// Und die Probe aufs Exempel: ein LEERES Blatt muss messbar anders
// herauskommen. Ohne diesen Vergleich wüsste ich nicht, ob die Schwelle
// oben überhaupt zwischen "voll" und "leer" unterscheidet.
const leerBild = await page.evaluate(async () => {
  try {
    document.getElementById('rapportBlatt').innerHTML = '';
    const c = await html2pdf().set({ margin: 10, html2canvas: { scale: 2 },
      jsPDF: { unit: 'mm', format: 'a4' } }).from(document.getElementById('rapportBlatt'))
      .toCanvas().get('canvas');
    if (!c.width || !c.height) { return { h: c.height, anteil: 0 }; }
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let dunkel = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] < 200 || d[i + 1] < 200 || d[i + 2] < 200) { dunkel++; }
    }
    return { h: c.height, anteil: dunkel / (d.length / 4) * 100 };
  } catch (e) { return { fehler: String(e) }; }
});
check('Die Messung unterscheidet wirklich zwischen vollem und leerem Blatt',
  !bild.fehler && (leerBild.fehler !== undefined || leerBild.anteil < 0.5 || leerBild.h < 400));

// ══════════ SCHLIESSEN RÄUMT AUF ══════════════════════════════════════
await page.evaluate(() => rgdZu());
await page.waitForTimeout(200);
check('Beim Schliessen bleiben die Daten der Runde nicht liegen',
  await page.evaluate(() => rgdDaten === null && rgdKarte === null));

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
