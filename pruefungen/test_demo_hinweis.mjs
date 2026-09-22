// Der Demo-Hinweis (ENT-656) -- der blockierende Bildschirm, der in einer
// Demo-Instanz vor der Tour steht.
//
// Zwei Sorten Befund haben diese Datei ausgeloest, beide am 2026-09-22 und
// beide NICHT im Quelltext sichtbar:
//
//  1. Der Kopf holte sich Foto und Schleier ueber var(--gate-schleier).
//     Die Variable war im #gate-Block deklariert und ausserhalb der
//     Anmeldemaske damit unbekannt -- eine background-Angabe mit einem
//     unaufgelösten var() ist ungueltig, das Foto fiel ersatzlos weg.
//     Gelesen sah die Regel richtig aus. Darum misst diese Datei, dass auf
//     dem Bildschirm wirklich ein FOTO liegt und nicht nur eine Flaeche.
//  2. Die beiden Rechtstexte wurden nachgeladen, lagen aber nur im
//     Homepage-Buendel. Auf der Demo-Instanz gab es die Dateien nicht, der
//     Abruf lief in den 404, und der Bildschirm zeigte statt der
//     Bedingungen zweimal "konnte nicht geladen werden". Auch das ist im
//     Quelltext unsichtbar: Der Aufruf ist richtig, die Kopierliste des
//     Deploys war es nicht.
//
// Geprueft wird jeweils die Aussage, nicht der Wortlaut (CLAUDE.md): nicht
// "steht das Wort anmeldung-nacht im CSS", sondern "liegt auf dem
// gerenderten Bildschirm ein Bild mit Struktur, und ist der Text darauf
// lesbar".
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);
const ev = (page, fn, ...a) => page.evaluate(fn, ...a).catch(() => null);

const dashboard = readFileSync(`${WURZEL}/dashboard.html`, 'utf8');
const workflow = readFileSync(`${WURZEL}/.github/workflows/deploy-hostpoint.yml`, 'utf8');

// ── 1. Was der Hinweis nachlaedt ─────────────────────────────────────────
//
// Welche Dateien abgerufen werden, wird weiter unten GEMESSEN (fetch wird
// mitgeschrieben), nicht aus dem Quelltext gelesen: Seit dem 2026-09-22
// haengt die Datenschutzerklaerung an einer Verzweigung, und eine Suche
// ueber den Quelltext faende beide Zweige, ohne zu wissen, welcher greift.
// Hier steht nur, DASS es die Funktion gibt.
const rumpf = (() => {
  const a = dashboard.indexOf('function dhRechtstextLaden()');
  return a < 0 ? '' : dashboard.slice(a, dashboard.indexOf('\n}\n', a));
})();
check('KRITISCH: der Demo-Hinweis hat eine Funktion, die die Rechtstexte nachlaedt',
  rumpf.length > 200);

// ── 1b. Der Abdruck datiert auf die Texte, die wirklich dastanden ──────
//
// Der Abdruck haelt fest, WELCHE Fassungen jemand bestaetigt hat. Bleibt
// eine Konstante beim naechsten Textwechsel stehen, datiert er die
// Zustimmung auf einen Text, den niemand gesehen hat -- er beweist dann das
// Gegenteil dessen, wofuer er da ist. nutzungsbedingungen.html warnt im
// eigenen Kopf davor, und test_recht.mjs fuehrt dieselbe Pruefung fuer die
// Zustimmung auf der Homepage. Dem Hinweis fehlte sie bis zum 2026-09-22.
//
// DREI DATEN, NICHT EINES: Der Hinweis legt zwei Texte vor, und von der
// Datenschutzerklaerung gibt es zwei Fassungen -- eine fuer einen
// Demo-Platz, eine fuer die gemeinsame Umgebung. Ein Abdruck, der nur die
// Nutzungsbedingungen datiert, beweist fuer den Rest nichts.
//
// Geprueft wird die Uebereinstimmung, nicht der Wortlaut der Konstanten.
{
  const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli',
    'August', 'September', 'Oktober', 'November', 'Dezember'];
  const datumAusSeite = (datei, muster) => {
    const t = readFileSync(`${WURZEL}/${datei}`, 'utf8').match(muster);
    return t ? `${t[3]}-${String(MONATE.indexOf(t[2]) + 1).padStart(2, '0')}-${t[1].padStart(2, '0')}` : null;
  };
  const kern = readFileSync(`${WURZEL}/backend/api/demo_hinweis_bestaetigen.php`, 'utf8');
  const konstante = name => {
    const m = kern.match(new RegExp(`const ${name}\\s*=\\s*'(\\d{4}-\\d{2}-\\d{2})'`));
    return m ? m[1] : null;
  };
  const paare = [
    ['DEMO_HINWEIS_FASSUNG', 'nutzungsbedingungen.html',
     /<p class="stand">Fassung vom (\d{1,2})\. (\p{L}+) (\d{4})<\/p>/u, 'die Nutzungsbedingungen'],
    ['DEMO_HINWEIS_DS_PLATZ', 'datenschutz-demo-platz.html',
     /<p class="stand">Stand: (\d{1,2})\. (\p{L}+) (\d{4})<\/p>/u, 'die Datenschutzerklaerung fuer einen Platz'],
    ['DEMO_HINWEIS_DS_GEMEINSAM', 'datenschutz-demo.html',
     /<p class="stand">Stand: (\d{1,2})\. (\p{L}+) (\d{4})<\/p>/u, 'die Datenschutzerklaerung der gemeinsamen Umgebung'],
  ];
  for (const [name, datei, muster, was] of paare) {
    const ausSeite = datumAusSeite(datei, muster);
    check(`KRITISCH: der Abdruck traegt das Datum, das in ${datei} steht (${was})`,
      ausSeite !== null && konstante(name) !== null && ausSeite === konstante(name));
  }

  // Beide Texte muessen IM Abdruck stehen, nicht nur als Konstante daneben.
  check('KRITISCH: der Abdruck nennt beide Texte -- eine Fassungsangabe, die nur die Bedingungen datiert, beweist fuer die Datenschutzerklaerung nichts',
    /DEMO_HINWEIS_FASSUNG/.test(kern) && /DEMO_HINWEIS_DS_PLATZ/.test(kern)
    && /DEMO_HINWEIS_DS_GEMEINSAM/.test(kern)
    && /ist_demo_platz\(\)/.test(kern));

  // Und er muss ins Feld passen. Eine zu kurze Spalte faellt nicht beim
  // Bauen auf, sondern erst beim Bestaetigen -- mitten in dem Bildschirm,
  // den ein Interessent zum Weiterkommen bestaetigen muss.
  const laengste = Math.max(
    ...['DEMO_HINWEIS_DS_PLATZ', 'DEMO_HINWEIS_DS_GEMEINSAM'].map(n =>
      `nb:${konstante('DEMO_HINWEIS_FASSUNG')},ds-platz:${konstante(n)}`.length));
  const kernTab = readFileSync(`${WURZEL}/backend/planung_einrichten_kern.php`, 'utf8');
  const breite = (() => {
    const i = kernTab.indexOf('CREATE TABLE IF NOT EXISTS demo_hinweis_bestaetigung');
    const m = i < 0 ? null : kernTab.slice(i, i + 400).match(/fassung VARCHAR\((\d+)\)/);
    return m ? Number(m[1]) : 0;
  })();
  check(`KRITISCH: das Fassungsfeld ist breit genug fuer beide Angaben (braucht ${laengste}, hat ${breite})`,
    breite >= laengste);

  // Eine bestehende Anlage hat die Spalte schon -- schmal. CREATE TABLE IF
  // NOT EXISTS aendert daran nichts, und kern_spalten() traegt nur FEHLENDE
  // Spalten nach. Ohne einen eigenen Nachtrag liefe der naechste Eintrag in
  // "Data too long".
  check('KRITISCH: bestehende Anlagen bekommen die groessere Breite nachgetragen',
    /ALTER TABLE demo_hinweis_bestaetigung MODIFY fassung VARCHAR\(60\)/.test(kernTab)
    && /CHARACTER_MAXIMUM_LENGTH/.test(kernTab));
}

// ── 2. Der gerenderte Bildschirm ─────────────────────────────────────────
const leuchte = (r, g, b) => {
  const k = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; };
  return .2126 * k(r) + .7152 * k(g) + .0722 * k(b);
};
const kontrastGegenLeuchte = (farbeStr, lb) => {
  const [r, g, b] = (farbeStr.match(/\d+/g) || []).slice(0, 3).map(Number);
  const [l1, l2] = [leuchte(r, g, b), lb].sort((x, y) => y - x);
  return (l1 + .05) / (l2 + .05);
};

const browser = await chromium.launch({ executablePath: browserPfad() });

// Der Hintergrund des Hinweises haengt am Rahmenkasten des Scrims, und der
// ist der Bildschirm -- er bewegt sich beim Scrollen NICHT. Eine Messung je
// Fenstergroesse genuegt darum; was hier hell ist, ist es an jeder Stelle
// des Textes. Genau darauf beruht auch die Gestaltung.
const messen = async (breite, hoehe) => {
  const page = await browser.newPage({ viewport: { width: breite, height: hoehe } });
  page.setDefaultTimeout(5000);
  page.on('pageerror', e => bad.push(`JS-Fehler (${breite}px): ` + e.message));
  await page.goto(`file://${WURZEL}/dashboard.html`);
  await page.waitForTimeout(400);
  // Im Betrieb erscheint der Hinweis NACH dem Anmelden -- die Maske ist
  // dann weg. Bleibt sie stehen, misst man ihr weisses Logo statt des
  // Hintergrunds des Hinweises (genau das ist beim Bauen passiert).
  await ev(page, () => { document.getElementById('gate').style.display = 'none'; dhZeigen(null); });
  await page.waitForTimeout(600);

  const sichtbar = await ev(page, () =>
    document.getElementById('dlgDemoHinweis').classList.contains('on'));

  // Schrift kurz unsichtbar, sonst misst man die Buchstaben gegen sich
  // selbst (Vorbild: textKontrastAufFoto in test_cockpit_gate.mjs).
  //
  // Gemessen wird die TEXTSPALTE ueber die volle Fensterhoehe, nicht das
  // ganze Fenster: Der Text steht in einer mittigen Spalte, das Foto ist
  // daneben deutlich heller (beleuchtete Fassade, Strassenlaternen). Wer
  // das ganze Fenster misst, misst eine Helligkeit, unter die nie ein
  // Buchstabe geraet -- und verlangt dafuer einen Schleier, der das Foto
  // zudeckt. Ueber die volle HOEHE aber schon: Der Text scrollt, der
  // Hintergrund nicht, also kommt jede Zeile irgendwann an jede Stelle.
  const spalte = await ev(page, () => {
    const r = document.querySelector('.dw-inhalt').getBoundingClientRect();
    return { x: Math.max(0, Math.floor(r.left)), b: Math.ceil(r.width) };
  });
  const farben = await ev(page, () => ({
    text: getComputedStyle(document.querySelector('.dw-inhalt p')).color,
    gruss: getComputedStyle(document.querySelector('.dw-hero h1')).color,
  }));
  // Alles ausblenden, was NICHT der Hintergrund des Hinweises ist -- auch
  // was darueber liegt: Die Plakette der Testumgebung sitzt unten rechts
  // ueber dem Scrim und war beim Bauen dieser Messung der hellste Punkt im
  // Bild. Sie ist ein Bedienelement mit eigenem Grund, kein Foto, und
  // haette hier einen Schleier verlangt, der nichts besser macht.
  await ev(page, () => {
    for (const e of document.body.children) {
      if (e.id !== 'dlgDemoHinweis') { e.style.visibility = 'hidden'; }
    }
    for (const s of ['.dw-inhalt', '.dw-hero', '.dw-fuss']) {
      document.querySelector(s).style.visibility = 'hidden';
    }
  });
  await page.waitForTimeout(150);
  const puffer = await page.screenshot().catch(() => null);
  await ev(page, () => {
    for (const e of document.body.children) { e.style.visibility = ''; }
    for (const s of ['.dw-inhalt', '.dw-hero', '.dw-fuss']) {
      document.querySelector(s).style.visibility = '';
    }
  });

  const bild = puffer && spalte && await page.evaluate(async ([b64, sp]) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/png;base64,' + b64; });
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    const skala = img.width / window.innerWidth;
    const d = c.getContext('2d').getImageData(
      Math.round(sp.x * skala), 0,
      Math.max(1, Math.round(sp.b * skala)), c.height).data;
    const lin = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; };
    let max = -1, min = 2, summe = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const L = .2126 * lin(d[i]) + .7152 * lin(d[i + 1]) + .0722 * lin(d[i + 2]);
      if (L > max) max = L;
      if (L < min) min = L;
      summe += L; n++;
    }
    return { max, min, mittel: summe / n };
  }, [puffer.toString('base64'), spalte]).catch(() => null);

  await page.close();
  return { sichtbar, farben, bild };
};

for (const [name, breite, hoehe] of [['Desktop', 1440, 900], ['Handy', 390, 844]]) {
  const m = await messen(breite, hoehe);
  check(`${name}: der Demo-Hinweis laesst sich oeffnen`, m.sichtbar === true);
  if (!m.bild || !m.farben) { check(`${name}: der Bildschirm liess sich fotografieren`, false); continue; }

  // Ein Foto hat Struktur, eine Farbflaeche nicht. Faellt das Bild weg (der
  // var()-Fehler oben), liegen hellster und dunkelster Punkt dicht
  // beieinander -- dann ist das hier rot, ohne dass irgendetwas "kaputt"
  // aussieht.
  check(`KRITISCH: ${name}: auf dem Hinweis liegt wirklich das Foto, nicht nur eine Flaeche`,
    m.bild.max - m.bild.min > 0.012);

  // Hell genug zum Lesen, dunkel genug fuers Foto: gemessen gegen den
  // HELLSTEN Bildpunkt, den fotografischen Worst-Case fuer helle Schrift.
  const kText = kontrastGegenLeuchte(m.farben.text, m.bild.max);
  const kGruss = kontrastGegenLeuchte(m.farben.gruss, m.bild.max);
  check(`KRITISCH: ${name}: der Flaechentext erreicht auf der hellsten Stelle des Fotos 4.5:1 (ist ${kText.toFixed(2)})`,
    kText >= 4.5);
  check(`KRITISCH: ${name}: der Gruss ueber dem Foto erreicht 4.5:1 (ist ${kGruss.toFixed(2)})`,
    kGruss >= 4.5);

  // Und die Gegenrichtung: Waere der Schleier deckend, waere der Text zwar
  // gut lesbar, das Foto aber nicht mehr zu sehen -- die Ansage war
  // ausdruecklich "Bild durchgehend zeigen".
  check(`${name}: der Schleier deckt das Foto nicht vollstaendig zu`,
    m.bild.mittel > 0.004);
}

// ── 2b. Welche Rechtstexte ein Demo-Platz wirklich abruft ────────────────
//
// GEMESSEN, NICHT GELESEN: fetch wird mitgeschrieben, waehrend der Hinweis
// aufgeht -- einmal als Demo-Platz (ENT-600/601: eigene Datenbank, ein
// Interessent, 14 Tage, KEIN naechtliches Leeren) und einmal als die eine
// ENT-523-Umgebung (gemeinsamer Zugang, naechtliches Leeren). Beide tragen
// APP_ENV=demo, es gibt also zwei richtige Antworten, und welche gilt,
// entscheidet erst window.APP_UMGEBUNG_DEMO_PLATZ.
//
// ANLASS (Projektinhaber, 2026-09-22, an der laufenden Anlage): Auf einem
// Demo-Platz stand in Ziffer 3 das naechtliche Leeren -- in einem Text, den
// man zum Weiterkommen erst durchscrollen muss. Derselbe Fehler war am
// 2026-09-21 schon einmal am Datenschutzverweis der Anmeldemaske behoben
// worden; der Hinweis hat die Verzweigung nicht geerbt. Genau die Sorte
// Fehler, vor der CLAUDE.md warnt: eine Regel, die etwas NEUES nicht
// mitbekommen hat.
const abrufe = async (alsPlatz) => {
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  p.setDefaultTimeout(5000);
  await p.goto(`file://${WURZEL}/dashboard.html`);
  await p.waitForTimeout(400);
  const liste = await ev(p, flag => {
    window.APP_UMGEBUNG_DEMO_PLATZ = flag;
    const gesehen = [];
    const echt = window.fetch;
    window.fetch = (u, ...rest) => { gesehen.push(String(u)); return echt(u, ...rest); };
    document.getElementById('gate').style.display = 'none';
    dhZeigen(null);
    window.fetch = echt;
    return gesehen;
  }, alsPlatz);
  const satz = await ev(p, () => document.getElementById('dhHerkunft').textContent.trim());
  await p.close();
  return { dateien: liste || [], satz: satz || '' };
};

const alsPlatz = await abrufe(true);
const alsGemeinsam = await abrufe(false);
const platzAbrufe = alsPlatz.dateien;
const gemeinsamAbrufe = alsGemeinsam.dateien;

// Derselbe Unterschied im eigenen Text des Hinweises. "Die Sie bereits
// bestaetigt haben" trifft auf einem Platz zu -- persoenlicher Zugang,
// derselbe Mensch hat ihn angefragt. Auf der gemeinsamen Umgebung nicht:
// Dort kann jedes der Mitarbeitendenkonten von irgendwem bedient werden,
// und GENAU DAS ist der Grund, aus dem es diesen Bildschirm gibt
// (ENT-656). Ein Eroeffnungssatz, der das Gegenteil behauptet, hebt seine
// eigene Begruendung auf. Stand bis zum 2026-09-22 unbedingt da.
check('KRITISCH: der Hinweis sagt auf einem Platz etwas anderes als auf der gemeinsamen Umgebung',
  alsPlatz.satz.length > 40 && alsGemeinsam.satz.length > 40 && alsPlatz.satz !== alsGemeinsam.satz);
check('KRITISCH: auf der gemeinsamen Umgebung behauptet der Hinweis NICHT, der Lesende habe selbst zugestimmt',
  !/\bSie\b[^.]{0,60}\bbest(ä|ae)tigt\b/.test(alsGemeinsam.satz));
check('auf einem Platz darf er es sagen -- dort stimmt es',
  /\bSie\b[^.]{0,60}\bbest(ä|ae)tigt\b/.test(alsPlatz.satz));

check('KRITISCH: ein Demo-Platz laedt die Bedingungen', platzAbrufe.includes('nutzungsbedingungen.html'));
check('KRITISCH: ein Demo-Platz laedt die Datenschutzerklaerung FUER EINEN PLATZ -- nicht die des gemeinsamen Zugangs, die vom naechtlichen Leeren erzaehlt',
  platzAbrufe.includes('datenschutz-demo-platz.html') && !platzAbrufe.includes('datenschutz-demo.html'));
check('KRITISCH: die eine ENT-523-Umgebung laedt weiterhin ihren eigenen Text',
  gemeinsamAbrufe.includes('datenschutz-demo.html') && !gemeinsamAbrufe.includes('datenschutz-demo-platz.html'));

// Und was ein Platz abruft, muss auf dem Platz auch liegen.
//
// Kopiert wird in die Demo-Plaetze, nicht nach dist/: Der Hinweis geht nur
// in einer Demo-Instanz auf, und ein Mandant haette sonst die
// Demo-Bedingungen unter seiner eigenen Adresse liegen.
//
// Verlangt wird das Ziel "dist-demo/$PLATZ/" und nicht bloss "dist-demo/":
// Eine Zeile mit einem festen Platznamen darin waere still falsch -- sie
// liefe durch, der Deploy bliebe gruen, und neun von zehn Plaetzen zeigten
// weiter "konnte nicht geladen werden". Ausdrueckliche Ansage des
// Projektinhabers (2026-09-22): "nicht nur auf demo3 anwenden, sondern auf
// allen 10 und auch kuenftigen". Die Platzliste selbst haelt
// test_demo_plaetze.mjs mit DEMO_PLAETZE in backend/demo_zugang.php
// zusammen; ein elfter Platz erbt die Zeilen damit von selbst.
const schleife = (() => {
  const a = workflow.indexOf('for PLATZ in $PLAETZE; do');
  if (a < 0) return '';
  const b = workflow.indexOf('\n          done', a);
  return b < 0 ? '' : workflow.slice(a, b);
})();
for (const datei of platzAbrufe.filter(d => /^[A-Za-z0-9_-]+\.html$/.test(d))) {
  const q = datei.replace(/\./g, '\\.');
  check(`KRITISCH: ${datei} wird auf die Demo-Plaetze kopiert -- sonst laeuft der Abruf auf der Instanz in den 404`,
    new RegExp(`cp\\s+${q}\\s+"dist-demo/`).test(workflow));
  check(`KRITISCH: ${datei} geht an JEDEN Platz ($PLATZ), nicht an einen bestimmten`,
    new RegExp(`cp\\s+${q}\\s+"dist-demo/\\$PLATZ/`).test(workflow));
  check(`KRITISCH: die Kopierzeile fuer ${datei} steht in der Schleife ueber alle Plaetze`,
    new RegExp(`cp\\s+${q}\\s`).test(schleife));
}

// ── 3. Die Sperre ────────────────────────────────────────────────────────
//
// Auf file:// laedt der Abruf der Rechtstexte nicht (der Browser laesst
// fetch() dort nicht zu) -- geprueft wird darum der Mechanismus an einem
// eingesetzten langen Text, nicht der Inhalt. Dass der richtige Inhalt
// ankommt, sichert Teil 1 oben ab.
//
// NACHGESTELLT WIRD DER FALL, DER LIVE SCHIEFGING: Beim Oeffnen stehen
// erst die kurzen Platzhalter da, der Text kommt nachtraeglich. Die erste
// Fassung schaltete in diesem Moment frei ("passt ins Fenster, also zu
// Ende gelesen") und sperrte nie wieder zu -- auf demo3 war der Knopf
// darum von Anfang an offen, und man kam ohne einen Blick in die
// Bedingungen durch. Die Reihenfolge hier ist deshalb Absicht: erst
// oeffnen, dann wachsen lassen.
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(5000);
await page.goto(`file://${WURZEL}/dashboard.html`);
await page.waitForTimeout(400);
await ev(page, () => {
  document.getElementById('gate').style.display = 'none';
  dhZeigen(null);
});
await page.waitForTimeout(200);

// Kein Kontrollkaestchen mehr: Wer eines ankreuzen kann, bevor er gelesen
// hat, braucht den Text nicht zu scrollen -- genau die Abkuerzung, die der
// Projektinhaber am 2026-09-22 beanstandet hat.
check('KRITISCH: es gibt kein Kontrollkaestchen, das die Sperre abkuerzt',
  (await ev(page, () => !document.querySelector('#dlgDemoHinweis input[type=checkbox]'))) === true);

// Solange die Texte noch unterwegs sind, ist nichts frei -- und zwar auch
// dann nicht, wenn man am Ende des Platzhalters steht. Darum hier
// ausdruecklich ans Ende scrollen: Ohne das haengt die Pruefung davon ab,
// wie hoch das Fenster gerade ist, und sie erreicht die Bedingung, die sie
// pruefen will, womoeglich gar nicht. Genau das ist ihr beim Schreiben
// passiert -- sie blieb gruen, als der Ladezaehler versuchsweise ausgebaut
// wurde.
const amEndeMitLuecke = await ev(page, () => {
  dhTexteOffen = 2;
  const s = document.getElementById('dlgDemoHinweis');
  s.scrollTop = s.scrollHeight;
  dhScrollPruefen();
  return s.scrollTop + s.clientHeight >= s.scrollHeight - 4;
});
check('die Pruefung steht wirklich am Ende -- sonst sagt der naechste Punkt nichts',
  amEndeMitLuecke === true);
check('KRITISCH: solange ein Rechtstext fehlt, bleibt der Knopf gesperrt -- am Ende des Platzhalters ist man nicht am Ende der Bedingungen',
  (await ev(page, () => document.getElementById('dhWeiterBtn').disabled)) === true);

// Jetzt kommen die Texte an, die Seite wird lang. Der Knopf muss gesperrt
// BLEIBEN, obwohl er beim Oeffnen kurz haette freigegeben werden koennen.
await ev(page, () => {
  document.getElementById('dhNutzungsbedingungen').innerHTML =
    Array.from({ length: 200 }, (_, i) => '<p>Zeile ' + i + '</p>').join('');
  dhTexteOffen = 0;
  dhScrollPruefen();
});
await page.waitForTimeout(300);
const oben = await ev(page, () => ({
  gesperrt: document.getElementById('dhWeiterBtn').disabled,
  hinweis: getComputedStyle(document.getElementById('dhScrollHinweis')).display !== 'none',
  scrollbar: (() => { const s = document.getElementById('dlgDemoHinweis');
    return s.scrollHeight > s.clientHeight + 4; })(),
}));
check('KRITISCH: der lange Text macht den Bildschirm ueberhaupt scrollbar', oben && oben.scrollbar === true);
check('KRITISCH: oben ist der Knopf gesperrt', oben && oben.gesperrt === true);
check('oben steht der Hinweis, dass bis zum Ende zu lesen ist', oben && oben.hinweis === true);

// Ans Ende scrollen -- erst hier wird frei.
await ev(page, () => { const s = document.getElementById('dlgDemoHinweis');
  s.scrollTop = s.scrollHeight; s.dispatchEvent(new Event('scroll')); });
await page.waitForTimeout(300);
const unten = await ev(page, () => ({
  knopf: document.getElementById('dhWeiterBtn').disabled,
  hinweis: getComputedStyle(document.getElementById('dhScrollHinweis')).display !== 'none',
}));
check('KRITISCH: unten angekommen wird der Knopf frei', unten && unten.knopf === false);
check('unten ist der Scroll-Hinweis weg', unten && unten.hinweis === false);

// Und wieder hinauf: Die Pruefung muss auch zurueck sperren. Sonst genuegt
// ein einziges Mal ganz nach unten, und danach zaehlt nichts mehr -- etwa
// wenn spaeter noch Text nachgeladen wird.
await ev(page, () => { const s = document.getElementById('dlgDemoHinweis');
  s.scrollTop = 0; s.dispatchEvent(new Event('scroll')); });
await page.waitForTimeout(300);
check('KRITISCH: zurueck nach oben sperrt wieder -- die Pruefung schaltet in beide Richtungen',
  (await ev(page, () => document.getElementById('dhWeiterBtn').disabled)) === true);

// Die Seite dahinter steht still, solange der Hinweis offen ist: sonst
// zwei Bildlaufleisten nebeneinander.
check('KRITISCH: die Seite hinter dem Hinweis ist stillgestellt -- keine zweite Bildlaufleiste',
  (await ev(page, () => getComputedStyle(document.documentElement).overflowY)) === 'hidden');
await page.close();

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden`);
if (bad.length) { console.log('\n✗ ' + bad.length + ' FEHLGESCHLAGEN:'); bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('\nAlle Pruefungen bestanden.');
