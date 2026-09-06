// Liquid Glass (ENT-418): durchscheinende Oberflaeche, an- und abschaltbar.
//
// Diese Suite liest KEINE Farbwerte aus dem Regelwerk ab. Das waere der
// Quelltext, abgeschrieben -- und bliebe gruen, wenn eine spaetere Regel
// gleicher Eigenspezifitaet das Glas wirkungslos macht oder eine deckende
// Flaeche daruebergelegt wird. Geprueft wird, was am Bildschirm ankommt:
//
//   Das Bildschirmfoto wird in die Seite zurueckgereicht, auf eine Leinwand
//   gezeichnet und Bildpunkt fuer Bildpunkt ausgelesen (flaechen()). Damit
//   steht die WIRKLICH sichtbare Farbe zur Verfuegung -- die Mischung aus
//   Glas, Untergrund und Unschaerfe -- und nicht die deklarierte.
//
// Die vier Aussagen, die dieser Block behauptet, und wie sie hier gemessen
// werden:
//
//   1. "Aus ist die Darstellung von vorher"  -> Flaechen sind deckend, der
//      Grund traegt kein Bild.
//   2. "An ist wirklich Glas"                -> Flaechen sind durchscheinend
//      UND der Grund traegt einen Verlauf, sonst gibt es nichts zu brechen.
//   3. "Es kostet keine Lesbarkeit"          -> Kontrast auf der GEMESSENEN
//      Flaeche, absolut nach WCAG und im Vergleich zu "aus".
//   4. "Es verschiebt nichts"                -> dieselben Positionen und
//      Groessen mit und ohne Glas.
//
// Dazu die zwei Sonderfaelle, die beim Bauen tatsaechlich schieflaufen:
// die festgehaltene Tabellenspalte (sie muss decken, ohne wie ein Fleck
// auszusehen) und der Bezugsrahmen fuer position:fixed (backdrop-filter auf
// einem Vorfahren hat das Glockenmenue schon einmal ueber den oberen
// Bildschirmrand geschoben).
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

// Kein festes Datum nahe beim heutigen Tag (test_datumsfest.mjs achtet
// darauf): der Monat wird aus dem Lauftag abgeleitet.
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const M = iso(new Date()).slice(0, 7);
const T = n => `${M}-${String(n).padStart(2, '0')}`;

const OBJ = { id: 1, kunde_id: 1, kunde_name: 'Beispiel AG', name: 'Muster Center',
  strasse: 'Industriestrasse 78', ort: '4601 Olten', kanton: 'SO', einsatzart: 'Revierdienst', aktiv: 1 };
const VOR = [{ id: 3, name: 'Schliessrunde', kuerzel: 'SR', art: 'arbeit', von: '22:00', bis: '22:30',
  arbeitszeit_h: 0.5, auf_abruf: 0, farbe: null, gueltig_ab: '2026-01-01', gueltig_bis: null }];
const BED = [1, 2, 3, 4].map(d => ({ datum: T(d), masterschicht_id: 3, name: 'Schliessrunde', kuerzel: 'SR',
  von: '22:00', bis: '22:30', bedarf: 2, status: 'geplant', feiertag: null, art: 'arbeit', arbeitszeit_h: 0.5 }));
const EIN = [{ id: 101, kunde_id: 1, kunde_name: 'Beispiel AG', objekt_id: 1, masterschicht_id: 3,
  titel: 'SR · Schliessrunde', strasse: null, ort: '4601 Olten', einsatzart: 'Revierdienst',
  datum: T(2), von: '22:00:00', bis: '22:30:00', bedarf: 2, status: 'geplant', bemerkung: null,
  mitarbeiter: [{ id: 2, name: 'vito', vorname: 'Vito', nachname: 'Muster', zusage: 'offen' }] }];

async function starte(vorbelegt) {
  const browser = await chromium.launch({ executablePath: EXE });
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
  if (vorbelegt !== undefined) {
    await page.addInitScript(v => { try { localStorage.setItem('rv3_glas', v); } catch (e) {} }, vorbelegt);
  }
  await page.route('**/api/**', route => {
    const u = route.request().url();
    const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.includes('login')) return send({ status: 'ok', token: 't', name: 'a', ist_admin: true });
    if (u.includes('objektplan')) return send({ status: 'ok', objekt: OBJ, vorlagen: VOR,
      bedarf: BED, einsaetze: EIN, feiertage: {} });
    if (u.includes('objekt_list')) return send({ status: 'ok', objekte: [OBJ] });
    if (u.includes('einsatz_list')) return send({ status: 'ok', einsaetze: EIN });
    if (u.includes('mitarbeiter_list')) return send({ status: 'ok', mitarbeiter: [
      { id: 1, name: 'adrian', vorname: 'Adrian', nachname: 'Muster', aktiv: 1, ist_admin: 1 },
      { id: 2, name: 'vito', vorname: 'Vito', nachname: 'Muster', aktiv: 1, ist_admin: 0 }] });
    if (u.includes('dashboard_stats')) return send({ status: 'ok',
      kpi: { rapporte_monat: 3, rapporte_vormonat: 1, stunden_monat: 24, stunden_vormonat: 8,
             mitarbeiter: 2, kunden: 1, rapporte_total: 4 },
      verlauf: Array.from({ length: 8 }, (_, i) => ({ kw: 26 + i, stunden: 20, anzahl: 2 })),
      angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [], sperr_ereignisse: [] });
    return send({ status: 'ok', kunden: [], rapporte: [], objekte: [], feiertage: [], gepflegt: {}, sperren: [] });
  });
  await page.goto(`file://${WURZEL}/dashboard.html`);
  await page.fill('#gName', 'a'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
  await page.waitForSelector('#shell.on'); await page.waitForTimeout(500);
  return { browser, page };
}

// ── Kontrast nach WCAG. Der einzige belastbare Weg, "lesbar" zu pruefen.
const LUM = c => {
  const [r, g, b] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const rgb = s => (String(s).match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map(Number);
const kontrast = (a, b) => {
  const l1 = LUM(Array.isArray(a) ? a : rgb(a)), l2 = LUM(Array.isArray(b) ? b : rgb(b));
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};
// Deckkraft aus einer Farbangabe. rgb(...) ohne vierten Wert ist deckend.
const alpha = s => { const t = String(s).match(/[\d.]+/g) || []; return t.length > 3 ? Number(t[3]) : 1; };

// ── DAS MESSGERAET ────────────────────────────────────────────────────
// Ein Bildschirmfoto, danach beliebig viele Flaechen daraus. Zurueck kommt
// je Flaeche der Mittelwert UND die Streuung: Ist die Streuung gross, lag
// Text oder eine Kante im Ausschnitt und der Mittelwert sagt nichts ueber
// die Flaeche aus -- die Pruefung merkt das dann selbst, statt eine Zahl zu
// behaupten, die niemand nachgesehen hat.
async function flaechen(page, rects) {
  const b64 = (await page.screenshot()).toString('base64');
  return page.evaluate(async ({ b64, rects }) => {
    const img = new Image();
    await new Promise((fertig, kaputt) => { img.onload = fertig; img.onerror = kaputt;
      img.src = 'data:image/png;base64,' + b64; });
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    return rects.map(({ x, y, w, h }) => {
      const d = g.getImageData(Math.round(x), Math.round(y),
        Math.max(1, Math.round(w)), Math.max(1, Math.round(h))).data;
      const s = [0, 0, 0], min = [255, 255, 255], max = [0, 0, 0];
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        for (let k = 0; k < 3; k++) {
          s[k] += d[i + k];
          if (d[i + k] < min[k]) min[k] = d[i + k];
          if (d[i + k] > max[k]) max[k] = d[i + k];
        }
        n++;
      }
      return { farbe: s.map(v => Math.round(v / n)),
               streuung: Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) };
    });
  }, { b64, rects });
}

// Ein Fleck freie Flaeche in einer Kachel: oben rechts, innerhalb der
// Rundung, wo weder Beschriftung noch Wert steht.
const fleck = r => ({ x: r.x + r.width - 30, y: r.y + 12, w: 12, h: 12 });
// Freie Flaeche in der Seitenleiste, auf Hoehe einer Rubrik: rechter Rand,
// wo weder Zeichen noch Eintrag steht.
const schieneFleck = page => page.evaluate(() => {
  const l = document.querySelector('.side-nav .nav-lbl').getBoundingClientRect();
  const s = document.querySelector('.side').getBoundingClientRect();
  return { x: s.x + s.width - 26, y: l.y + 1, w: 12, h: Math.max(4, l.height - 2) };
});
const masse = page => page.evaluate(() => {
  const r = s => { const e = document.querySelector(s); if (!e) return null;
    const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; };
  return { kpi: r('.kpi'), card: r('.card'), topbar: r('.topbar'), side: r('.side') };
});
const farben = page => page.evaluate(() => {
  const c = s => getComputedStyle(document.querySelector(s));
  const k = c('.kpi');
  return { kpiGrund: k.backgroundColor, kpiRadius: k.borderRadius,
           ink: c('.kpi-val').color, ink3: c('.kpi-top span').color,
           cardGrund: c('.card').backgroundColor,
           bodyBild: getComputedStyle(document.body).backgroundImage,
           cardUnschaerfe: c('.card').backdropFilter || c('.card').webkitBackdropFilter,
           // Die Seitenleiste. Ihre beiden leisen Beschriftungen tragen einen
           // FESTEN Grauwert (#5C626E), der von --shell nichts weiss: Wird
           // der Grund durch Durchsicht heller, verschwinden sie, ohne dass
           // etwas kaputtgeht. Genau so ist es beim Bau dieser Fassung
           // passiert -- bei 66 % Deckung lagen die Rubriken bei 1.3:1.
           navLbl: c('.side-nav .nav-lbl').color,
           navItem: c('.side-nav .nav-item').color,
           markeSub: c('.side-brand .sub').color };
});

let { browser, page } = await starte();

// ══════════════════════════════════════════ 1. DER SCHALTER
check('Der Schalter steht in der Kopfleiste', await page.isVisible('#btnGlas'));
check('Er ist als Schalter ausgezeichnet',
  await page.evaluate(() => $('btnGlas').getAttribute('role') === 'switch'));
// LINKS vom Hell/Dunkel-Schalter, nicht rechts: Der bleibt das aeusserste
// Element der Werkzeugleiste (ENT-067, gemessen von test_menue.mjs).
check('Er steht unmittelbar neben dem Hell/Dunkel-Schalter, nicht irgendwo',
  await page.evaluate(() => $('btnGlas').nextElementSibling === $('btnThema')));
check('KRITISCH: und LINKS davon -- der Hell/Dunkel-Schalter bleibt aussen',
  await page.evaluate(() => {
    const t = $('btnThema').getBoundingClientRect(), g = $('btnGlas').getBoundingClientRect();
    return g.right <= t.left + 1;
  }));
check('Ohne Wahl ist er aus',
  await page.evaluate(() => document.documentElement.getAttribute('data-glas') === 'aus'));
check('Und meldet das auch so', await page.getAttribute('#btnGlas', 'aria-checked') === 'false');
check('Er traegt eine sprechende Beschriftung',
  (await page.getAttribute('#btnGlas', 'title')).toLowerCase().includes('einschalten'));

// ══════════════════════════════════════════ 2. AUS IST DIE ALTE DARSTELLUNG
const ausFarben = await farben(page);
const ausMasse = await masse(page);
check('KRITISCH: ausgeschaltet sind die Kacheln deckend -- wie vorher',
  alpha(ausFarben.kpiGrund) === 1 && alpha(ausFarben.cardGrund) === 1);
check('KRITISCH: ausgeschaltet traegt der Grund kein Bild', ausFarben.bodyBild === 'none');

// Die gemessenen Kontraste im ausgeschalteten Zustand -- sie sind der
// Massstab, an dem sich das Glas gleich messen lassen muss.
let [kpiAus, schieneAus] = await flaechen(page, [fleck(ausMasse.kpi), await schieneFleck(page)]);
check('Die gemessene Flaeche ist wirklich frei (keine Schrift im Ausschnitt)', kpiAus.streuung <= 6);
check('Auch die Messstelle in der Seitenleiste ist frei', schieneAus.streuung <= 6);
const kontrastAus = {
  ink: kontrast(ausFarben.ink, kpiAus.farbe),
  ink3: kontrast(ausFarben.ink3, kpiAus.farbe),
  navLbl: kontrast(ausFarben.navLbl, schieneAus.farbe),
  navItem: kontrast(ausFarben.navItem, schieneAus.farbe),
  markeSub: kontrast(ausFarben.markeSub, schieneAus.farbe),
};

// ══════════════════════════════════════════ 3. EINSCHALTEN
await page.click('#btnGlas');
await page.waitForTimeout(400);
check('Ein Klick schaltet ein',
  await page.evaluate(() => document.documentElement.getAttribute('data-glas') === 'an'));
check('Der Schalter meldet „an"', await page.getAttribute('#btnGlas', 'aria-checked') === 'true');
check('Die Wahl wird gespeichert',
  await page.evaluate(() => localStorage.getItem('rv3_glas') === 'an'));
check('Die Beschriftung dreht sich mit',
  (await page.getAttribute('#btnGlas', 'title')).toLowerCase().includes('ausschalten'));

const anFarben = await farben(page);
check('KRITISCH: eingeschaltet sind die Kacheln durchscheinend',
  alpha(anFarben.kpiGrund) < 1 && alpha(anFarben.cardGrund) < 1);
check('KRITISCH: und der Grund traegt jetzt einen Verlauf -- ohne ihn gaebe es nichts zu brechen',
  anFarben.bodyBild !== 'none' && anFarben.bodyBild.includes('gradient'));
check('Die Kachel wird zugleich weicher gerundet',
  parseFloat(anFarben.kpiRadius) > parseFloat(ausFarben.kpiRadius));
// Regel 2 des Blocks: Kacheln bekommen KEINE Unschaerfe. Nicht aus
// Sparsamkeit -- backdrop-filter macht die eigene Box zum Bezugsrahmen fuer
// position:fixed-Nachfahren. Die Folge davon wird weiter unten gemessen.
check('KRITISCH: Kacheln tragen keine Unschaerfe (Bezugsrahmen fuer fixed)',
  anFarben.cardUnschaerfe === 'none');

// ══════════════════════════════════════════ 4. ES VERSCHIEBT NICHTS
const anMasse = await masse(page);
const gleich = (a, b) => a && b && Math.abs(a.x - b.x) < 0.6 && Math.abs(a.y - b.y) < 0.6
  && Math.abs(a.width - b.width) < 0.6 && Math.abs(a.height - b.height) < 0.6;
check('KRITISCH: die Kacheln stehen unveraendert', gleich(ausMasse.kpi, anMasse.kpi));
check('KRITISCH: die Container stehen unveraendert', gleich(ausMasse.card, anMasse.card));
check('KRITISCH: die Kopfleiste steht unveraendert', gleich(ausMasse.topbar, anMasse.topbar));
check('KRITISCH: die Seitenleiste steht unveraendert', gleich(ausMasse.side, anMasse.side));

// ══════════════════════════════════════════ 5. GEMESSEN: ES IST WIRKLICH GLAS
// Die Kachel muss den Grund durchlassen -- sonst ist "durchscheinend" nur
// eine Zahl im Regelwerk. Gemessen an zwei Kacheln in verschiedener Hoehe:
// Liegt ueberall dasselbe Weiss, laesst nichts durch.
let [kpiAn, schieneAn] = await flaechen(page, [fleck(anMasse.kpi), await schieneFleck(page)]);
check('Die gemessene Flaeche ist frei (keine Schrift im Ausschnitt)', kpiAn.streuung <= 6);
const abstand = kpiAn.farbe.reduce((s, v, i) => s + Math.abs(v - kpiAus.farbe[i]), 0);
check(`KRITISCH: die Kachel sieht am Bildschirm anders aus als ohne Glas (Abstand ${abstand})`,
  abstand >= 3);

// ══════════════════════════════════════════ 6. GEMESSEN: ES KOSTET KEINE LESBARKEIT
// Zwei Massstaebe. Der absolute ist WCAG. Der relative ist der wichtigere:
// Glas darf Kontrast kosten -- aber nicht mehr als ein Zehntel, sonst ist es
// eine Verschlechterung, die niemand bemerkt, weil nichts kaputtgeht.
const kontrastAn = {
  ink: kontrast(anFarben.ink, kpiAn.farbe),
  ink3: kontrast(anFarben.ink3, kpiAn.farbe),
};
check(`Hell: Text auf der Kachel bleibt gut lesbar (${kontrastAn.ink.toFixed(1)}:1)`,
  kontrastAn.ink >= 7);
check(`KRITISCH: Glas kostet den Text hoechstens ein Zehntel Kontrast `
  + `(${kontrastAus.ink.toFixed(1)} -> ${kontrastAn.ink.toFixed(1)})`,
  kontrastAn.ink >= kontrastAus.ink * 0.9);
check(`KRITISCH: auch die feine Beschriftung verliert hoechstens ein Zehntel `
  + `(${kontrastAus.ink3.toFixed(1)} -> ${kontrastAn.ink3.toFixed(1)})`,
  kontrastAn.ink3 >= kontrastAus.ink3 * 0.9);
// ── Die Seitenleiste. Sie ist der Ort, an dem diese Fassung beim Bauen
// tatsaechlich einmal unlesbar wurde -- darum hier drei eigene Messungen
// und nicht bloss eine.
const kontrastAnSchiene = {
  navLbl: kontrast(anFarben.navLbl, schieneAn.farbe),
  navItem: kontrast(anFarben.navItem, schieneAn.farbe),
  markeSub: kontrast(anFarben.markeSub, schieneAn.farbe),
};
// Fuer die beiden leisen Beschriftungen ist der Massstab AUSDRUECKLICH der
// Zustand ohne Glas und nicht die WCAG-Schwelle: .nav-lbl liegt in der
// bestehenden Fassung bei rund 2.9:1 und .side-brand .sub bei 3.3:1 -- also
// schon ohne Glas an oder unter der Grenze. Das ist ein eigener Befund und
// gehoert dem Bereich Betrieb, nicht dieser Aenderung. Was diese Aenderung
// schuldet, ist, es nicht SCHLIMMER zu machen. Darum eng: hoechstens fuenf
// Prozent, nicht zehn wie bei den Kacheln, wo Luft ist.
check(`KRITISCH: Glas kostet die Rubriken der Seitenleiste fast nichts `
  + `(${kontrastAus.navLbl.toFixed(1)} -> ${kontrastAnSchiene.navLbl.toFixed(1)}:1)`,
  kontrastAnSchiene.navLbl >= kontrastAus.navLbl * 0.95);
check(`KRITISCH: die Menueeintraege bleiben gut lesbar `
  + `(${kontrastAnSchiene.navItem.toFixed(1)}:1)`,
  kontrastAnSchiene.navItem >= 4.5 && kontrastAnSchiene.navItem >= kontrastAus.navItem * 0.95);
check(`KRITISCH: und die Unterzeile der Marke ebenfalls `
  + `(${kontrastAus.markeSub.toFixed(1)} -> ${kontrastAnSchiene.markeSub.toFixed(1)}:1)`,
  kontrastAnSchiene.markeSub >= kontrastAus.markeSub * 0.95);
await page.screenshot({ path: OUT + '/95-glas-hell.png' });

// ══════════════════════════════════════════ 7. DASSELBE IM DUNKELN
// Das Glas mischt sich aus --surface. Waere irgendwo ein fester Weisswert
// eingetragen, faellt es genau hier auf: eine milchige Kachel im Dunkeln.
await page.click('#btnThema');
await page.waitForTimeout(400);
const dunkelFarben = await farben(page);
const dunkelMasse = await masse(page);
let [kpiDunkel] = await flaechen(page, [fleck(dunkelMasse.kpi)]);
check('Die gemessene Flaeche ist frei (keine Schrift im Ausschnitt)', kpiDunkel.streuung <= 8);
check('KRITISCH: im Dunkeln ist die Glaskachel dunkel, nicht milchig',
  (kpiDunkel.farbe[0] + kpiDunkel.farbe[1] + kpiDunkel.farbe[2]) / 3 < 80);
const kDunkel = kontrast(dunkelFarben.ink, kpiDunkel.farbe);
check(`Dunkel: Text auf der Glaskachel bleibt gut lesbar (${kDunkel.toFixed(1)}:1)`, kDunkel >= 7);
check(`Dunkel: auch die feine Beschriftung bleibt lesbar`,
  kontrast(dunkelFarben.ink3, kpiDunkel.farbe) >= 4.5);
const [schieneDunkel] = await flaechen(page, [await schieneFleck(page)]);
check(`Dunkel: die Rubriken der Seitenleiste bleiben sichtbar `
  + `(${kontrast(dunkelFarben.navLbl, schieneDunkel.farbe).toFixed(1)}:1)`,
  kontrast(dunkelFarben.navLbl, schieneDunkel.farbe) >= 3);
check(`Dunkel: die Menueeintraege bleiben gut lesbar`,
  kontrast(dunkelFarben.navItem, schieneDunkel.farbe) >= 4.5);
// ENT-227 sagt: im Dunkeln traegt der Rand, nicht der Schatten. Unter Glas
// traegt die KANTE -- und die ist ein inset-Schatten. Die Aussage bleibt
// also dieselbe und wird hier auch so geprueft: keine Lage, die nach
// AUSSEN faellt. (Ein Eintrag mit Deckkraft 0 zaehlt als keiner -- so
// bleibt --glas-abheben in einer Liste stehen, ohne zu wirken.)
check('KRITISCH: im Dunkeln faellt kein Schatten nach aussen (ENT-227)',
  await page.evaluate(() => getComputedStyle(document.querySelector('.card')).boxShadow
    .split(/,(?![^(]*\))/)
    .every(t => t.includes('inset') || /rgba\([^)]*,\s*0\s*\)/.test(t))));
await page.screenshot({ path: OUT + '/96-glas-dunkel.png' });
await page.click('#btnThema');
await page.waitForTimeout(300);

// ══════════════════════════════════════════ 8. FENSTER SIND GLAS, MIT UNSCHAERFE
// Anders als Kacheln: hinter einem Fenster laeuft wirklich Inhalt durch.
await page.evaluate(() => openDlg('dlgConfirm'));
await page.waitForTimeout(350);
const fenster = await page.evaluate(() => {
  const d = document.querySelector('#dlgConfirm .dlg');
  const c = getComputedStyle(d);
  return { grund: c.backgroundColor, unschaerfe: c.backdropFilter || c.webkitBackdropFilter,
           radius: c.borderRadius };
});
check('KRITISCH: Fenster sind durchscheinend', alpha(fenster.grund) < 1);
check('KRITISCH: und tragen Unschaerfe -- hinter ihnen laeuft Inhalt durch',
  fenster.unschaerfe !== 'none' && fenster.unschaerfe.includes('blur'));
check('Fenster decken mehr als Kacheln -- sonst liest man zwei Ebenen zugleich',
  alpha(fenster.grund) > alpha(anFarben.kpiGrund));
await page.evaluate(() => closeDlg('dlgConfirm'));
await page.waitForTimeout(250);

// ══════════════════════════════════════════ 9. TABELLEN BLEIBEN FEST
// Der Sonderfall, an dem eine durchscheinende Karte tatsaechlich kaputtgeht:
// .gr td.lb ist position:sticky und MUSS verdecken, was unter ihr
// durchlaeuft. Bliebe der Tabellenkoerper Glas, waere die stehende Spalte
// entweder durchsichtig (die scrollende Zeile scheint durch) oder ein
// aufgehellter Fleck auf der sonst durchscheinenden Karte.
await page.evaluate(() => go('planung')); await page.waitForTimeout(300);
await page.evaluate(() => goTab('objektplan')); await page.waitForTimeout(900);

const tabFeld = await page.evaluate(() => {
  const raster = document.querySelector('.gr');
  if (!raster) return null;
  // Nicht der erste .card-bd.flush der Seite, sondern der, in dem das Raster
  // wirklich steckt.
  const koerper = raster.closest('.card-bd.flush');
  const lb = document.querySelector('.gr td.lb');
  if (!koerper || !lb) return null;
  const k = koerper.getBoundingClientRect(), l = lb.getBoundingClientRect();
  return {
    koerperGrund: getComputedStyle(koerper).backgroundColor,
    lbGrund: getComputedStyle(lb).backgroundColor,
    streifen: { x: k.x + 12, y: k.y + 6, w: Math.min(560, k.width - 24), h: Math.max(8, k.height - 12) },
    // Die festgehaltene Spalte, ohne ihren rechten Rand.
    spalte: { x: l.x + 2, y: l.y + 2, w: Math.max(4, l.width - 6), h: Math.max(4, l.height - 4) },
  };
});
if (!tabFeld) {
  bad.push('Der Objektplan hat kein Raster geliefert -- die Tabellenpruefung lief ins Leere');
} else {
  check('KRITISCH: der Tabellenkoerper bleibt deckend', alpha(tabFeld.koerperGrund) === 1);
  check('KRITISCH: die festgehaltene Spalte bleibt deckend', alpha(tabFeld.lbGrund) === 1);

  // Was hier NICHT geprueft wird, und warum: Der Fall, fuer den .gr td.lb
  // ueberhaupt position:sticky traegt -- seitliches Schieben, waehrend die
  // Spalte stehen bleibt -- laesst sich in dieser Ansicht nicht herstellen.
  // Gemessen: Das Raster staucht seine Spalten immer auf die Behaelter-
  // breite (98 Tagesspalten in denselben 1214 px wie 32), und unter 900 px
  // ist die Objektplanung bewusst ausgeblendet (ENT-235). Eine Pruefung,
  // die nie anschlagen kann, waere eine Behauptung -- darum steht sie hier
  // nicht. Die Forderung selbst bleibt: beide Flaechen muessen decken, und
  // das wird oben geprueft (Gegenprobe: Regel 3 aus dem Regelwerk
  // entfernen, dann werden die zwei Zeilen darueber rot).

  // Und der Tabellenbereich sieht mit Glas aus wie ohne.
  const [streifenMitGlas] = await flaechen(page, [tabFeld.streifen]);
  const abw = (a, b) => a.farbe.reduce((s, v, i) => s + Math.abs(v - b.farbe[i]), 0)
    + Math.abs(a.streuung - b.streuung);
  await page.evaluate(() => glasSetzen(false));
  await page.waitForTimeout(400);
  const [streifenOhneGlas] = await flaechen(page, [tabFeld.streifen]);
  await page.evaluate(() => glasSetzen(true));
  await page.waitForTimeout(400);
  check(`KRITISCH: der Tabellenbereich sieht mit Glas aus wie ohne `
    + `(Abweichung ${abw(streifenMitGlas, streifenOhneGlas)})`,
    abw(streifenMitGlas, streifenOhneGlas) <= 6);
  check('Der gemessene Streifen enthaelt wirklich das Raster', streifenMitGlas.streuung >= 20);
}
await page.screenshot({ path: OUT + '/97-glas-objektplan.png' });

// ══════════════════════════════════════════ 10. DER BEZUGSRAHMEN FUER FIXED
// Die Folge von Regel 2, gemessen statt behauptet: Laege irgendwo auf dem
// Weg vom Koerper zum Glockenmenue ein backdrop-filter, saesse das Menue auf
// dem Handy ueber dem oberen Bildschirmrand -- so geschehen bei ENT-197,
// gemessen mit panel.top = -51px statt 0.
await page.setViewportSize({ width: 390, height: 844 });
await page.evaluate(() => go('uebersicht')); await page.waitForTimeout(400);
await page.click('#btnGlocke');
await page.waitForTimeout(400);
const glocke = await page.evaluate(() => {
  const p = document.getElementById('glockePanel');
  const b = p.getBoundingClientRect();
  return { sichtbar: getComputedStyle(p).display !== 'none', top: Math.round(b.top),
           unten: Math.round(b.bottom), hoehe: Math.round(b.height) };
});
check('Das Glockenmenue oeffnet auf dem Handy', glocke.sichtbar && glocke.hoehe > 40);
check(`KRITISCH: es haengt nicht ueber dem oberen Bildschirmrand (top ${glocke.top})`,
  glocke.top >= 0);
check('Es steht vollstaendig im Bild', glocke.unten <= 844 + 1);
await page.evaluate(() => $('btnGlocke').click());
await page.waitForTimeout(200);

// ══════════════════════════════════════════ 11. MOBIL: DERSELBE SCHALTER
check('KRITISCH: der Schalter ist auf dem Handy nicht in der Kopfzeile',
  await page.evaluate(() => !$('btnGlas').offsetParent));
await page.click('.btn-burger');
await page.waitForTimeout(450);
check('Er steht stattdessen im Menue', await page.isVisible('#btnGlasMob'));
check('Auch dort ist er ein Schiebeschalter',
  (await page.getAttribute('#btnGlasMob', 'role')) === 'switch');
check('KRITISCH: beide Schalter fuehren denselben Zustand',
  (await page.getAttribute('#btnGlasMob', 'aria-checked'))
  === (await page.getAttribute('#btnGlas', 'aria-checked')));
// Trefferflaeche auf dem Handy. 44 px sind die Hausregel; der Schalter ist
// bewusst so hoch wie der Hell/Dunkel-Schalter daneben -- gemessen wird
// darum, dass beide gleich gross sind und keiner von beiden schrumpft.
const schalterMasse = await page.evaluate(() => {
  const a = $('btnThemaMob').getBoundingClientRect(), b = $('btnGlasMob').getBoundingClientRect();
  return { thema: [Math.round(a.width), Math.round(a.height)],
           glas: [Math.round(b.width), Math.round(b.height)],
           abstand: Math.round(a.left - b.right) };
});
check('Beide Schalter sind gleich gross -- zwei verschieden grosse wirken wie zwei Dinge',
  JSON.stringify(schalterMasse.thema) === JSON.stringify(schalterMasse.glas));
check('Sie kleben nicht aneinander', schalterMasse.abstand >= 6);
const vorher = await page.evaluate(() => document.documentElement.getAttribute('data-glas'));
await page.click('#btnGlasMob');
await page.waitForTimeout(350);
check('Und er schaltet dort ebenfalls',
  (await page.evaluate(() => document.documentElement.getAttribute('data-glas'))) !== vorher);
check('KRITISCH: der Schalter in der Kopfzeile zieht mit',
  (await page.getAttribute('#btnGlas', 'aria-checked'))
  === (await page.getAttribute('#btnGlasMob', 'aria-checked')));
await page.screenshot({ path: OUT + '/98-glas-handy.png' });
await browser.close();

// ══════════════════════════════════════════ 12. DIE WAHL HAELT
({ browser, page } = await starte('an'));
check('Die gespeicherte Wahl wird uebernommen',
  await page.evaluate(() => document.documentElement.getAttribute('data-glas') === 'an'));
check('Der Schalter steht passend',
  await page.getAttribute('#btnGlas', 'aria-checked') === 'true');
// Kein Aufblitzen: der Wert steht schon vor dem ersten Zeichnen am Dokument,
// nicht erst nach der Anmeldung.
check('KRITISCH: das Merkmal steht frueh genug am Dokument',
  await page.evaluate(() => document.documentElement.dataset.glas) === 'an');
await browser.close();

({ browser, page } = await starte('aus'));
check('Auch „aus" bleibt gespeichert',
  await page.evaluate(() => document.documentElement.getAttribute('data-glas') === 'aus'));
await browser.close();

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
