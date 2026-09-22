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

// ── 1. Was der Hinweis nachlaedt, muss im Cockpit-Buendel liegen ─────────
//
// Gelesen wird der Rumpf der ladenden Funktion, nicht die ganze Datei: Eine
// Suche ueber dashboard.html faende auch jeden Verweis in einem Kommentar.
const rumpf = (() => {
  const a = dashboard.indexOf('function dhRechtstextLaden()');
  return a < 0 ? '' : dashboard.slice(a, dashboard.indexOf('\n}\n', a));
})();
check('KRITISCH: der Demo-Hinweis hat eine Funktion, die die Rechtstexte nachlaedt',
  rumpf.length > 200);

const nachgeladen = [...rumpf.matchAll(/'([A-Za-z0-9_-]+\.html)'/g)].map(m => m[1])
  .filter((q, i, arr) => arr.indexOf(q) === i);
check('KRITISCH: der Hinweis laedt mindestens zwei Rechtstexte nach (Bedingungen und Datenschutz)',
  nachgeladen.length >= 2);
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
for (const datei of nachgeladen) {
  const q = datei.replace(/\./g, '\\.');
  check(`KRITISCH: ${datei} wird auf die Demo-Plaetze kopiert -- sonst laeuft der Abruf auf der Instanz in den 404`,
    new RegExp(`cp\\s+${q}\\s+"dist-demo/`).test(workflow));
  check(`KRITISCH: ${datei} geht an JEDEN Platz ($PLATZ), nicht an einen bestimmten`,
    new RegExp(`cp\\s+${q}\\s+"dist-demo/\\$PLATZ/`).test(workflow));
}

// Und die Schleife drumherum: Die Zeilen muessen im Rumpf von
// "for PLATZ in $PLAETZE" stehen. Stuenden sie davor oder dahinter, waere
// $PLATZ leer oder der letzte Platz -- auch das liefe durch.
const schleife = (() => {
  const a = workflow.indexOf('for PLATZ in $PLAETZE; do');
  if (a < 0) return '';
  const b = workflow.indexOf('\n          done', a);
  return b < 0 ? '' : workflow.slice(a, b);
})();
for (const datei of nachgeladen) {
  check(`KRITISCH: die Kopierzeile fuer ${datei} steht in der Schleife ueber alle Plaetze`,
    schleife.includes(`cp ${datei}`) || new RegExp(`cp\\s+${datei.replace(/\./g, '\\.')}\\s`).test(schleife));
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

// ── 3. Die Sperre ────────────────────────────────────────────────────────
//
// Auf file:// laedt der Abruf der Rechtstexte nicht (der Browser laesst
// fetch() dort nicht zu) -- geprueft wird darum der Mechanismus an einem
// eingesetzten langen Text, nicht der Inhalt. Dass der richtige Inhalt
// ankommt, sichert Teil 1 oben ab.
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(5000);
await page.goto(`file://${WURZEL}/dashboard.html`);
await page.waitForTimeout(400);
await ev(page, () => {
  document.getElementById('gate').style.display = 'none';
  dhZeigen(null);
  document.getElementById('dhNutzungsbedingungen').innerHTML =
    Array.from({ length: 200 }, (_, i) => '<p>Zeile ' + i + '</p>').join('');
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

await ev(page, () => { const s = document.getElementById('dlgDemoHinweis');
  s.scrollTop = s.scrollHeight; s.dispatchEvent(new Event('scroll')); });
await page.waitForTimeout(300);
const unten = await ev(page, () => ({
  kasten: document.getElementById('dhCheckbox').disabled,
  knopf: document.getElementById('dhWeiterBtn').disabled,
}));
check('KRITISCH: unten angekommen ist das Kaestchen freigegeben', unten && unten.kasten === false);
check('KRITISCH: der Knopf bleibt gesperrt, solange nicht angekreuzt ist', unten && unten.knopf === true);

await ev(page, () => { document.getElementById('dhCheckbox').checked = true; dhCheckboxGeaendert(); });
await page.waitForTimeout(150);
check('KRITISCH: erst mit Haken wird der Knopf frei',
  (await ev(page, () => document.getElementById('dhWeiterBtn').disabled)) === false);
await page.close();

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden`);
if (bad.length) { console.log('\n✗ ' + bad.length + ' FEHLGESCHLAGEN:'); bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('\nAlle Pruefungen bestanden.');
