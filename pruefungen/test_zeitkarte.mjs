// Datum & Zeit und das Kontomenue am Logo (ENT-410, Kacheln seit ENT-423).
//
// Beides kam mit derselben Ansage des Projektinhabers: Die Begruessung nahm
// die ganze Breite ein, daneben soll die Kalenderwoche stehen; das Logo
// wandert nach rechts aussen, und die Symbole, die dort standen, klappen
// darunter auf.
//
// Seit ENT-423 stehen Datum und Uhrzeit als Kacheln da -- eine Klappuhr und
// eine Tageskachel. Damit verschiebt sich, WO der Wert steht: Er verteilt
// sich auf vier Halbflaechen je Kachel und auf drei Kuerzel, und der
// ausgeschriebene Satz existiert nur noch als aria-label. Deshalb liest diese
// Pruefung den Wert nicht mehr aus einem Textknoten, sondern aus den
// Flaechen, die tatsaechlich zu sehen sind -- was der Code zu zeigen
// GLAUBT (dataset.wert), ist hier nirgends der Pruefgegenstand.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const browser = await chromium.launch({ executablePath: EXE });

// Anordnung vorbelegen? Dann kommt sie in den Speicher, BEVOR die Seite
// laedt -- der Umzug aus ENT-410 soll sie ja gerade beim Laden vorfinden.
async function seite(breite = 1600, vorbelegt, umzugSchonGelaufen = false, thema) {
  const p = await browser.newPage({ viewport: { width: breite, height: 1000 } });
  p.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
  if (thema) { await p.addInitScript(t => { try { localStorage.setItem('rv3_thema', t); } catch (e) {} }, thema); }
  if (vorbelegt !== undefined) {
    // Nur beim ERSTEN Laden vorbelegen. Ohne diese Sperre setzt Playwright
    // die alte Anordnung bei jedem Neuladen zurueck und ueberschreibt, was
    // der Umzug gespeichert hat -- die Pruefung unten saehe dann einen
    // Fehler, den es gar nicht gibt.
    await p.addInitScript(v => { try {
      if (!localStorage.getItem('rv3_dash_layout')) { localStorage.setItem('rv3_dash_layout', v); }
    } catch (e) {} }, vorbelegt);
  }
  if (umzugSchonGelaufen) {
    await p.addInitScript(() => { try { localStorage.setItem('rv3_dash_zeit_umzug', '2'); } catch (e) {} });
  }
  await p.route('**/api/**', r => {
    const u = r.request().url();
    const send = b => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.includes('login')) return send({ status: 'ok', token: 't', name: 'a.muster', ist_admin: true });
    if (u.includes('dashboard_stats')) return send({ status: 'ok',
      kpi: { rapporte_monat: 0, rapporte_vormonat: 0, stunden_monat: 0, stunden_vormonat: 0,
             mitarbeiter: 1, kunden: 1, rapporte_total: 0 },
      verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [], sperr_ereignisse: [] });
    return send({ status: 'ok', einsaetze: [], kunden: [], rapporte: [], objekte: [],
      mitarbeiter: [], feiertage: [], gepflegt: {}, sperren: [] });
  });
  await p.goto(`file://${WURZEL}/dashboard.html`);
  await p.fill('#gName', 'a'); await p.fill('#gPass', 'x'); await p.click('#gBtn');
  await p.waitForSelector('#shell.on'); await p.waitForTimeout(400);
  return p;
}

// Im Browser: Welche Ziffern zeigt eine Klappkachel gerade WIRKLICH?
//
// Vier Halbflaechen liegen uebereinander, zwei davon klappen. Eine hochkant
// stehende Klappe ist nicht zu sehen, auch wenn sie im Baum steht und Text
// traegt. Geprueft wird deshalb, was nach Sichtbarkeit und Drehlage uebrig
// bleibt -- bei rotateX steht der Kosinus des Winkels in m22, und bei
// 90 Grad ist er 0.
const SICHTBARE_ZIFFERN = `(id) => {
  const k = document.getElementById(id);
  return [...k.querySelectorAll('.zk-h')].filter(h => {
    const s = getComputedStyle(h);
    if (s.visibility === 'hidden' || s.display === 'none' || s.opacity === '0') { return false; }
    if (s.transform === 'none') { return true; }
    return Math.abs(new DOMMatrix(s.transform).m22) > .02;
  }).map(h => h.querySelector('span').textContent.trim());
}`;

// ══════════════════════════════ DIE KARTE ZEIGT, WAS SIE SOLL
try {
  const p = await seite();
  const w = await p.evaluate(sz => {
    const zeigt = eval(sz);
    const t = id => document.getElementById(id).textContent.trim();
    return {
      kw: t('zeitKw'), spanne: t('zeitSpanne'),
      // Die Tageskachel: drei Stuecke auf dem Bildschirm, ein Satz im Label.
      tagKachel: [t('zeitWt'), t('zeitMo'), t('zeitTag')],
      datum: document.getElementById('zeitDatum').getAttribute('aria-label').trim(),
      uhr: document.getElementById('zeitUhr').getAttribute('aria-label').trim(),
      std: zeigt('zeitStd'), min: zeigt('zeitMin'),
    };
  }, SICHTBARE_ZIFFERN);

  // Die Wochenzahl wird NICHT aus dem Dashboard uebernommen, sondern hier
  // unabhaengig gerechnet -- und bewusst anders herum als dort: kalenderwoche()
  // geht ueber den Donnerstag der Woche, diese Rechnung ueber den Montag der
  // Woche, die den 4. Januar enthaelt (nach ISO 8601 immer die Woche 1).
  // Beide muessen dasselbe Ergebnis liefern. Schriebe die Pruefung die
  // Formel des Dashboards ab, waere sie auch dann gruen, wenn beide
  // gemeinsam falsch rechnen.
  const jetzt = new Date();
  const montagVon = d => { const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    m.setDate(m.getDate() - ((m.getDay() + 6) % 7)); return m; };
  const mo = montagVon(jetzt);
  // Das Jahr der Woche ist das Jahr ihres Donnerstags, nicht das ihres Montags.
  const do_ = new Date(mo); do_.setDate(do_.getDate() + 3);
  const wocheEins = montagVon(new Date(do_.getFullYear(), 0, 4));
  const sollKw = Math.round((mo - wocheEins) / (7 * 864e5)) + 1;
  check('KRITISCH: die Kalenderwoche stimmt mit einer unabhaengigen Rechnung ueberein',
    Number(w.kw) === sollKw);
  check('Sie steht als blosse Zahl da, ohne "KW" davor', /^\d{1,2}$/.test(w.kw));

  // Die Spanne muss den heutigen Tag einschliessen -- ohne Bezug ist eine
  // Wochenzahl nur eine Zahl.
  const so = new Date(mo); so.setDate(so.getDate() + 6);
  check('Die Wochenspanne nennt den Montag dieser Woche', w.spanne.startsWith(mo.getDate() + '.'));
  check('Und endet am Sonntag', new RegExp(`\\b${so.getDate()}\\.`).test(w.spanne.split('–')[1]));
  check('Sie nennt ein Jahr, damit die Woche datiert ist', /\b20\d\d$/.test(w.spanne));

  check('Das Datum nennt den Wochentag',
    ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag']
      .some(t => w.datum.startsWith(t)));
  check('KRITISCH: und es ist der heutige Tag',
    w.datum.includes(jetzt.getDate() + '.') && w.datum.includes(String(jetzt.getFullYear())));

  // Die Tageskachel zeigt Kuerzel. Sie muessen zum ausgeschriebenen Satz
  // passen -- sonst liest der Bildschirm etwas anderes vor als der
  // Screenreader, und niemand von beiden merkt es.
  const [kuerzelWt, kuerzelMo, tagZahl] = w.tagKachel;
  check('KRITISCH: die Tageskachel zeigt den heutigen Tag als Zahl',
    tagZahl === String(jetzt.getDate()));
  check('KRITISCH: ihr Wochentagskuerzel gehoert zum ausgeschriebenen Wochentag',
    kuerzelWt.length >= 2 && w.datum.startsWith(kuerzelWt));
  check('KRITISCH: und ihr Monatskuerzel zum ausgeschriebenen Monat',
    kuerzelMo.length >= 3 && w.datum.includes(kuerzelMo));

  // Die Uhrzeit. Gelesen aus den Flaechen, die zu sehen sind -- nicht aus
  // dem Wert, den der Code sich gemerkt hat.
  check('Die Uhrzeit steht als HH:MM da', /^\d{2}:\d{2}$/.test(w.uhr));
  check('KRITISCH: die Uhrzeit ist die jetzige, nicht irgendeine',
    Math.abs((Number(w.uhr.slice(0, 2)) * 60 + Number(w.uhr.slice(3)))
      - (jetzt.getHours() * 60 + jetzt.getMinutes())) <= 2);
  check('Keine Sekunden -- eine Ziffer, die jede Sekunde springt, zieht den Blick weg',
    !/\d{2}:\d{2}:\d{2}/.test(w.uhr));
  check('In Ruhe zeigt jede Klappkachel genau einen Wert, nicht zwei nebeneinander',
    w.std.length > 0 && new Set(w.std).size === 1 && w.min.length > 0 && new Set(w.min).size === 1);
  check('KRITISCH: was die Kacheln zeigen, ist auch das, was ihre Beschriftung sagt',
    w.std[0] + ':' + w.min[0] === w.uhr);
  await p.close();
} catch (e) { bad.push('Inhalt: ' + String(e).split('\n')[0].slice(0, 120)); }

// ══════════════════════════════ DIE WOCHENSPANNE UEBER MONATS- UND JAHRESGRENZEN
//
// Feste Daten, aber weit von heute weg (2021) -- sie werden nie mit "heute"
// verglichen, sondern nur formatiert. Genau die Faelle, die man von Hand
// selten nachstellt und die deshalb lange falsch bleiben.
try {
  const p = await seite();
  const f = await p.evaluate(() => ({
    imMonat: zeitSpanne(new Date(2021, 8, 6), new Date(2021, 8, 12)),
    ueberMonat: zeitSpanne(new Date(2021, 8, 27), new Date(2021, 9, 3)),
    ueberJahr: zeitSpanne(new Date(2021, 11, 27), new Date(2022, 0, 2)),
  }));
  check('Innerhalb eines Monats steht der Monat nur einmal',
    f.imMonat === '6. – 12. September 2021');
  check('KRITISCH: ueber den Monatswechsel stehen beide Monate',
    f.ueberMonat === '27. September – 3. Oktober 2021');
  check('KRITISCH: ueber den Jahreswechsel stehen beide Jahre',
    f.ueberJahr === '27. Dezember 2021 – 2. Januar 2022');
  await p.close();
} catch (e) { bad.push('Wochenspanne: ' + String(e).split('\n')[0].slice(0, 120)); }

// ══════════════════════════════ GESTALTUNG: UEBERSCHRIFT OBEN, WERT DARUNTER
//
// Der Wert ist seit den Kacheln nicht mehr in jedem Block ein Textknoten --
// bei Datum und Uhrzeit ist es die Kachel selbst. Geprueft wird deshalb der
// Werttraeger, nicht die Klasse .wert.
try {
  const p = await seite();
  const g = await p.evaluate(() => {
    const zeilen = [...document.querySelectorAll('.zeit-zeile')].map(z => {
      const lb = z.querySelector('.lb');
      const v = z.querySelector('.wert, .zk-uhr, .zk-tag');
      return { hatWert: !!v,
               lblOben: v ? lb.getBoundingClientRect().bottom <= v.getBoundingClientRect().top + 1 : false,
               lblKlein: parseFloat(getComputedStyle(lb).fontSize),
               lblGroesse: getComputedStyle(lb).fontSize,
               versal: getComputedStyle(lb).textTransform };
    });
    const karte = document.querySelector('.zeit-karte').getBoundingClientRect();
    const bd = document.querySelector('.zeit-karte .card-bd');
    const r = s => document.querySelector(s).getBoundingClientRect();
    const kacheln = [...document.querySelectorAll('.zk-klapp, .zk-tag')].map(k => k.getBoundingClientRect());
    return { zeilen,
      ueberlauf: [...document.querySelectorAll('.zeit-zeile')]
        .reduce((m, z) => Math.max(m, z.getBoundingClientRect().bottom), 0) - karte.bottom,
      // Steht keine Kachel weiter rechts, als die Karte reicht?
      randUeberlauf: Math.max(...kacheln.map(k => k.right)) - (bd.getBoundingClientRect().right
        - parseFloat(getComputedStyle(bd).paddingRight)),
      // Kein Kachelinhalt darf ueber seine Kachel hinausragen -- passiert
      // still, sobald der Flex-Algorithmus eine Kachel zusammendrueckt.
      zifferPasst: [...document.querySelectorAll('.zk-klapp')].every(k => {
        const kr = k.getBoundingClientRect();
        const rg = document.createRange();
        rg.selectNodeContents(k.querySelector('.zk-h-o span'));
        const gr = rg.getBoundingClientRect();
        return gr.left >= kr.left - .5 && gr.right <= kr.right + .5;
      }),
      // Die Klappkante schneidet die Ziffer mittig -- sonst sieht die Kachel
      // aus wie ein Feld mit einem Strich darin.
      kanteMittig: (() => {
        const k = document.querySelector('.zk-klapp').getBoundingClientRect();
        const rg = document.createRange();
        rg.selectNodeContents(document.querySelector('.zk-klapp .zk-h-o span'));
        const gr = rg.getBoundingClientRect();
        return Math.abs((gr.top + gr.height / 2) - (k.top + k.height / 2));
      })(),
      gleichHoch: Math.abs(r('.zk-uhr').height - r('.zk-tag').height) < 1,
      kwUeberDenObjekten: r('.zeit-kw').bottom <= r('.zeit-objekte').top + 1,
    };
  });
  check('Es sind drei Bloecke: Woche, Tag, Uhrzeit', g.zeilen.length === 3);
  check('Jeder traegt einen Wert', g.zeilen.every(z => z.hatWert));
  check('KRITISCH: in jedem Block steht die Ueberschrift ueber dem Wert',
    g.zeilen.every(z => z.lblOben));
  check('Und versal gesetzt, wie ueberall sonst', g.zeilen.every(z => z.versal === 'uppercase'));
  check('KRITISCH: alle drei Ueberschriften sind gleich gross -- gleiches Muster auf beiden Seiten',
    new Set(g.zeilen.map(z => z.lblGroesse)).size === 1);
  check('KRITISCH: Datum und Uhrzeit sind gleich hoch, sonst wirkt eine der beiden abgeschnitten',
    g.gleichHoch);
  check('Die Woche steht weiterhin ueber Tag und Uhrzeit -- von der groben zur feinen Einheit',
    g.kwUeberDenObjekten);
  check('KRITISCH: nichts laeuft unten aus der Karte heraus', g.ueberlauf <= 1);
  check('KRITISCH: und keine Kachel ueber den rechten Rand hinaus', g.randUeberlauf <= 1);
  check('KRITISCH: keine Ziffer ragt aus ihrer Kachel -- eine gequetschte Kachel bricht nichts,'
    + ' sieht aber falsch aus', g.zifferPasst);
  check('KRITISCH: die Klappkante schneidet die Ziffer mittig (Abweichung unter 2 px)',
    g.kanteMittig < 2);
  await p.screenshot({ path: OUT + '/90-zeitkarte.png',
    clip: { x: 800, y: 130, width: 790, height: 340 } });
  await p.close();
} catch (e) { bad.push('Gestaltung: ' + String(e).split('\n')[0].slice(0, 120)); }

// ══════════════════════════════ DIE KACHELN SIND IN BEIDEN THEMEN DUNKEL
//
// Ausdruecklicher Entscheid des Projektinhabers: Eine helle Klappuhr sieht
// aus wie ein Eingabefeld. Die Kachelfarben stehen deshalb NICHT bei den
// Themenwerten -- diese Pruefung ist das, was sie dort haelt, wenn beim
// naechsten Themen-Feinschliff jemand die Werte einsammelt.
//
// Gemessen wird die Helligkeit der gerenderten Farbe, nicht der Hex-Wert:
// Eine Pruefung auf "#1C212C" waere schon dann gruen, wenn eine spaetere
// Regel die Flaeche laengst weiss faerbt.
try {
  const hell = f => { const [r, g, b] = f.match(/[\d.]+/g).map(Number);
    return (.2126 * r + .7152 * g + .0722 * b) / 255; };
  for (const thema of ['hell', 'dunkel']) {
    const p = await seite(1600, undefined, false, thema);
    const f = await p.evaluate(() => {
      const cs = s => getComputedStyle(document.querySelector(s));
      return { oben: cs('.zk-klapp .zk-h-o').backgroundColor,
               unten: cs('.zk-klapp .zk-h-u').backgroundColor,
               tag: cs('.zk-tag').backgroundColor,
               ziffer: cs('.zk-klapp').color,
               tagZahl: cs('.zk-tag-zahl').color,
               wochentag: cs('.zk-wt').color,
               kante: cs('.zk-klapp .zk-h-o').getPropertyValue('--zk-kante').trim()
                 ? (() => { const d = document.createElement('div');
                     d.style.backgroundColor = getComputedStyle(document.querySelector('.zeit-raster'))
                       .getPropertyValue('--zk-kante');
                     document.body.appendChild(d);
                     const c = getComputedStyle(d).backgroundColor; d.remove(); return c; })()
                 : 'rgb(0, 0, 0)',
               karte: cs('.zeit-karte').backgroundColor };
    });
    check(`Im Thema "${thema}": beide Haelften der Klappuhr sind dunkel`,
      hell(f.oben) < .2 && hell(f.unten) < .2);
    check(`Im Thema "${thema}": die Tageskachel ebenso`, hell(f.tag) < .2);
    check(`KRITISCH: im Thema "${thema}" stehen helle Ziffern darauf`,
      hell(f.ziffer) > .8 && hell(f.tagZahl) > .8);
    // Als Verhaeltnis, nicht als Differenz: Im dunklen Thema liegt die Karte
    // selbst schon bei 0.1 Helligkeit, dort ist eine Differenz von 0.1 nach
    // unten gar nicht mehr zu haben. Eine Pruefung, die das verlangt, waere
    // nicht streng, sondern unerfuellbar -- und wuerde mit der Zeit
    // weggelassen statt erfuellt.
    const verh = (a, b) => (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    check(`KRITISCH: im Thema "${thema}" hebt sich die Kachel von der Karte ab`,
      verh(hell(f.karte), hell(f.oben)) >= 1.3);
    check(`Im Thema "${thema}" ist die Klappkante auf der Kachel zu sehen`,
      verh(hell(f.oben), hell(f.kante)) >= 1.2);
    check(`KRITISCH: im Thema "${thema}" bleibt die Ziffer auf der Kachel gut lesbar`,
      verh(hell(f.ziffer), hell(f.oben)) >= 3);
    // Rot heisst in dieser Oberflaeche "gesperrt" -- der Wochentag darf das
    // Rot der Vorlage darum nicht uebernehmen.
    const [wr, wg, wb] = f.wochentag.match(/[\d.]+/g).map(Number);
    check(`Im Thema "${thema}" ist der Wochentag nicht rot -- Rot heisst hier "gesperrt"`,
      !(wr > 150 && wr - Math.max(wg, wb) > 45));
    await p.close();
  }
} catch (e) { bad.push('Kachelfarben: ' + String(e).split('\n')[0].slice(0, 120)); }

// ══════════════════════════════ DIE KLAPPUHR KLAPPT -- UND ZEIGT DANACH DEN NEUEN WERT
//
// Der Fehler, den eine Pruefung auf dataset.wert nicht sehen wuerde: Die
// Kachel merkt sich den neuen Wert, zeigt aber weiter den alten, weil eine
// der vier Halbflaechen nicht mitgezogen ist. Gelesen wird darum, was am
// Ende sichtbar ist.
try {
  const p = await seite();
  const lauf = await p.evaluate(sz => {
    const zeigt = eval(sz);
    const k = document.getElementById('zeitMin');
    const vorher = zeigt('zeitMin');
    const neu = vorher[0] === '07' ? '08' : '07';
    const ruhigVorher = !k.classList.contains('laeuft');
    klappSetzen(k, neu);
    return { vorher, neu, ruhigVorher, laeuftJetzt: k.classList.contains('laeuft') };
  }, SICHTBARE_ZIFFERN);
  check('KRITISCH: beim ersten Zeichnen klappt nichts -- eine Uhr, die beim Laden'
    + ' durchklappt, behauptet einen Wechsel, den es nicht gab', lauf.ruhigVorher);
  check('Ein echter Minutenwechsel loest die Bewegung aus', lauf.laeuftJetzt);

  // Mitten in der Bewegung darf der alte Wert noch zu sehen sein -- das ist
  // die Bewegung. Danach nicht mehr.
  await p.waitForTimeout(1000);
  const danach = await p.evaluate(sz => eval(sz)('zeitMin'), SICHTBARE_ZIFFERN);
  check('KRITISCH: nach der Bewegung steht ueberall der neue Wert',
    danach.length > 0 && danach.every(z => z === lauf.neu));
  check('KRITISCH: und nirgends mehr der alte', !danach.includes(lauf.vorher[0]));

  // Und die Beschriftung darf nicht zurueckbleiben: Sie wird an anderer
  // Stelle gesetzt als die Kacheln.
  const rund = await p.evaluate(sz => {
    const zeigt = eval(sz);
    zeitZeichnen();
    return { std: zeigt('zeitStd'), min: zeigt('zeitMin'),
             label: document.getElementById('zeitUhr').getAttribute('aria-label') };
  }, SICHTBARE_ZIFFERN);
  await p.waitForTimeout(900);
  const rund2 = await p.evaluate(sz => ({ std: eval(sz)('zeitStd'), min: eval(sz)('zeitMin'),
    label: document.getElementById('zeitUhr').getAttribute('aria-label') }), SICHTBARE_ZIFFERN);
  check('KRITISCH: nach dem naechsten Durchlauf stimmen Kacheln und Beschriftung wieder ueberein',
    rund2.std[0] + ':' + rund2.min[0] === rund2.label);
  check('Die Stundenkachel klappt dabei nicht mit, wenn nur die Minute wechselt',
    new Set(rund.std).size === 1);
  await p.close();
} catch (e) { bad.push('Klappen: ' + String(e).split('\n')[0].slice(0, 120)); }

// ══════════════════════════════ DIE BREITE KARTE TEILT SICH IN DREI GLEICHE SPALTEN
//
// Genau hier ist beim Bauen ein Fehler passiert, den man nicht sieht: Die
// Regel fuer die breite Karte stand VOR .zeit-objekte und blieb bei gleicher
// Eigenspezifitaet wirkungslos. Gemessen kamen Spalten von 648/298/298 px
// heraus statt drei gleichen -- kaputt sah dabei nichts aus.
try {
  const p = await seite();
  await p.evaluate(() => { const e = document.querySelector('[data-widget="zeit"]');
    e.classList.remove('dw-halb'); e.classList.add('dw-voll'); });
  await p.waitForTimeout(300);
  const b = await p.evaluate(() => {
    const r = s => document.querySelector(s).getBoundingClientRect();
    const bd = document.querySelector('.zeit-karte .card-bd');
    const cs = getComputedStyle(bd);
    const kacheln = [...document.querySelectorAll('.zk-klapp, .zk-tag')].map(k => k.getBoundingClientRect());
    return {
      nebeneinander: Math.abs(r('.zeit-kw').top - r('.zeit-objekte').top) < 2
        && r('.zeit-objekte').left >= r('.zeit-kw').right - 1,
      spalten: [r('.zeit-kw').width, r('.zeit-tag').width, r('.zeit-uhr').width],
      randUeberlauf: Math.max(...kacheln.map(k => k.right))
        - (r('.zeit-karte .card-bd').right - parseFloat(cs.paddingRight)),
      hoehe: r('.zk-tag').height,
      untenRaus: r('.zeit-objekte').bottom - r('.zeit-karte').bottom,
    };
  });
  check('KRITISCH: auf voller Breite stehen die Bloecke nebeneinander', b.nebeneinander);
  const [kw, tag, uhr] = b.spalten;
  check('KRITISCH: Datum und Uhrzeit bekommen gleich viel Breite',
    Math.abs(tag - uhr) < 2);
  check('KRITISCH: und die Wochenzahl ebenfalls, statt die halbe Karte zu nehmen',
    Math.abs(kw - tag) < 40);
  check('KRITISCH: auch dort laeuft keine Kachel ueber den Rand', b.randUeberlauf <= 1);
  check('Und nichts unten heraus', b.untenRaus <= 1);
  check('Die Kacheln sind dabei nicht kleiner als auf halber Breite', b.hoehe >= 130);

  // Die Spalte ist hier am engsten -- und eine zu enge Spalte quetscht die
  // Kacheln, statt dass etwas ueberlaeuft. Gemessen wurde eine Uhr, die
  // 217 px braucht, auf 158 px zusammengedrueckt; die Ziffern standen
  // seitlich ueber ihrer Kachel, ohne dass eine Ueberlaufmessung anschlug.
  // Durchgegangen wird eine Reihe von Kartenbreiten, weil die Kachelgroesse
  // mit der Breite waechst: Die knappste Lage liegt nicht am Rand des
  // Bereichs, sondern irgendwo darin.
  const eng = [];
  for (const breite of [1120, 1240, 1360, 1520, 1700, 1900]) {
    await p.setViewportSize({ width: breite, height: 1000 });
    await p.waitForTimeout(220);
    eng.push(await p.evaluate(b2 => {
      const passt = k => {
        const kr = k.getBoundingClientRect();
        const rg = document.createRange();
        rg.selectNodeContents(k.querySelector('.zk-h-o span'));
        const gr = rg.getBoundingClientRect();
        return gr.left >= kr.left - .5 && gr.right <= kr.right + .5;
      };
      const soll = [...document.querySelectorAll('.zk-klapp')]
        .map(k => k.getBoundingClientRect().width);
      const h = document.querySelector('.zk-tag').getBoundingClientRect().height;
      return { breite: b2,
               // Die Kachelbreite folgt der Hoehe. Weicht sie ab, ist die
               // Kachel gestaucht worden.
               gestaucht: soll.some(w => Math.abs(w - h * 1.22) > 1.5),
               zifferDrin: [...document.querySelectorAll('.zk-klapp')].every(passt) };
    }, breite));
  }
  const gestaucht = eng.filter(x => x.gestaucht).map(x => x.breite);
  const rausgeragt = eng.filter(x => !x.zifferDrin).map(x => x.breite);
  check('KRITISCH: keine Kartenbreite drueckt die Kacheln zusammen'
    + (gestaucht.length ? ' (gestaucht bei ' + gestaucht.join(', ') + ' px)' : ''),
    gestaucht.length === 0);
  check('KRITISCH: und bei keiner ragt eine Ziffer aus ihrer Kachel'
    + (rausgeragt.length ? ' (bei ' + rausgeragt.join(', ') + ' px)' : ''),
    rausgeragt.length === 0);
  await p.close();
} catch (e) { bad.push('Volle Breite: ' + String(e).split('\n')[0].slice(0, 120)); }

// ══════════════════════════════ AM HANDY NICHT
//
// Entscheid des Projektinhabers: Kalenderwoche, Datum und Uhrzeit stehen auf
// dem Handy schon in der Statusleiste des Geraets. Der Container bleibt in
// der Liste -- ausgeblendet ist nur die Anzeige, nicht der Container.
try {
  const p = await seite(390);
  check('KRITISCH: am Handy steht die Karte nicht in der Uebersicht',
    !(await p.isVisible('.dash-item[data-widget="zeit"]')));
  check('Der Container bleibt aber in der Liste, damit die Anordnung nicht verrutscht',
    await p.evaluate(() => DASH_WIDGETS.some(w => w.id === 'zeit')
      && !!document.querySelector('.dash-item[data-widget="zeit"]')));
  await p.setViewportSize({ width: 1500, height: 1000 });
  await p.waitForTimeout(300);
  check('KRITISCH: am Desktop ist sie da — "ausgeblendet" heisst nicht "weg"',
    await p.isVisible('.dash-item[data-widget="zeit"]'));
  await p.close();
} catch (e) { bad.push('Handy: ' + String(e).split('\n')[0].slice(0, 120)); }

// ══════════════════════════════ DER EINMALIGE UMZUG GESPEICHERTER ANORDNUNGEN
//
// Wer die Uebersicht schon einmal angepasst hat, hat die Begruessung meist
// auf voller Breite stehen. Ein neuer Container reiht sich laut
// ordAbgleichen() ganz hinten ein -- ohne Umzug landete "Datum & Zeit" also
// unter allem anderen, waehrend oben weiter die breite Begruessung stuende.
try {
  const alt = JSON.stringify([
    { id: 'begruessung', sichtbar: true, breite: 'voll' },
    { id: 'kpi', sichtbar: true, breite: 'voll' },
    { id: 'letzte', sichtbar: true },
  ]);
  const p = await seite(1600, alt);
  const nach = await p.evaluate(() => ordStand('uebersicht').map(x => ({ id: x.id, breite: x.breite })));
  const i = nach.findIndex(x => x.id === 'begruessung');
  check('KRITISCH: die Begruessung steht danach auf halber Breite',
    nach[i] && nach[i].breite === 'halb');
  check('KRITISCH: und "Datum & Zeit" direkt daneben, nicht am Ende der Liste',
    nach[i + 1] && nach[i + 1].id === 'zeit' && nach[i + 1].breite === 'halb');
  const nebeneinander = await p.evaluate(() => {
    const r = w => document.querySelector(`[data-widget="${w}"]`).getBoundingClientRect();
    return Math.abs(r('begruessung').top - r('zeit').top) < 1 && r('zeit').left >= r('begruessung').right - 1;
  });
  check('KRITISCH: gemessen stehen die beiden auch wirklich nebeneinander', nebeneinander);
  check('Die uebrige Anordnung bleibt, wie sie war',
    nach.filter(x => x.id === 'kpi')[0].breite === 'voll'
    && nach.findIndex(x => x.id === 'kpi') > i + 1);

  // Gegenprobe: Ist der Umzug einmal gelaufen, greift er nicht noch einmal.
  // Sonst spraenge jede spaeter von Hand gesetzte Breite bei jedem Laden
  // zurueck -- und der Benutzer haette keinen Anhaltspunkt warum.
  const p2 = await seite(1600, JSON.stringify([
    { id: 'begruessung', sichtbar: true, breite: 'voll' },
    { id: 'zeit', sichtbar: true, breite: 'voll' },
  ]), true);
  const nach2 = await p2.evaluate(() => ordStand('uebersicht').map(x => ({ id: x.id, breite: x.breite })));
  check('KRITISCH: ein zweites Mal zieht der Umzug nicht mehr um',
    nach2[0].id === 'begruessung' && nach2[0].breite === 'voll');
  await p.close(); await p2.close();
} catch (e) { bad.push('Umzug: ' + String(e).split('\n')[0].slice(0, 120)); }

// ══════════════════════════════ DER UMZUG UEBERSTEHT DAS NEULADEN
//
// Die Pruefung, die beim ersten Anlauf gefehlt hat (ENT-412). Der Umzug
// stellte die Anordnung nur im Arbeitsspeicher um und setzte den Merker,
// schrieb sie aber nie zurueck. Beim ersten Aufruf stimmte das Bild --
// beim naechsten Laden las ordLaden() wieder die ALTE Anordnung, der
// Merker blockierte den Umzug, und "Datum & Zeit" fiel ans Ende der Liste.
// Eine Pruefung, die nur den ersten Aufruf ansieht, ist an genau dieser
// Stelle blind.
try {
  const alt = JSON.stringify([
    { id: 'begruessung', sichtbar: true, breite: 'voll' },
    { id: 'kpi', sichtbar: true, breite: 'voll' },
    { id: 'letzte', sichtbar: true },
  ]);
  const p = await seite(1600, alt);
  const lage = async () => p.evaluate(() => {
    const stand = ordStand('uebersicht');
    const i = stand.findIndex(x => x.id === 'begruessung');
    const r = w => document.querySelector(`[data-widget="${w}"]`).getBoundingClientRect();
    return { breite: stand[i] && stand[i].breite,
             danach: stand[i + 1] && stand[i + 1].id,
             nebeneinander: Math.abs(r('begruessung').top - r('zeit').top) < 1,
             gespeichert: (JSON.parse(localStorage.getItem('rv3_dash_layout') || '[]')).map(x => x.id) };
  });
  const vorher = await lage();
  check('Nach dem Umzug steht "Datum & Zeit" neben der Begrüssung',
    vorher.breite === 'halb' && vorher.danach === 'zeit' && vorher.nebeneinander);
  check('KRITISCH: der Umzug wird auch GESPEICHERT, nicht nur angezeigt',
    vorher.gespeichert.includes('zeit'));

  await p.reload();
  await p.waitForSelector('#shell.on'); await p.waitForTimeout(500);
  const nachher = await lage();
  check('KRITISCH: nach dem Neuladen steht sie immer noch daneben',
    nachher.breite === 'halb' && nachher.danach === 'zeit' && nachher.nebeneinander);
  check('KRITISCH: und die Begrüssung springt nicht auf volle Breite zurück',
    nachher.breite === 'halb');
  await p.close();
} catch (e) { bad.push('Neuladen: ' + String(e).split('\n')[0].slice(0, 120)); }

// ══════════════════════════════ EIN ALTER, FEHLERHAFTER MERKER WIRD NACHGEHOLT
//
// Wer die erste Fassung schon geladen hat, traegt einen Merker der Stufe
// "1" und eine unveraenderte Anordnung. Ohne Stufenwechsel liefe der Umzug
// bei ihm nie wieder -- die Uebersicht bliebe dauerhaft falsch angeordnet.
try {
  const p = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  p.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
  await p.addInitScript(() => { try {
    if (localStorage.getItem('rv3_dash_layout')) { return; }
    localStorage.setItem('rv3_dash_zeit_umzug', '1');
    localStorage.setItem('rv3_dash_layout', JSON.stringify([
      { id: 'begruessung', sichtbar: true, breite: 'voll' }, { id: 'kpi', sichtbar: true }]));
  } catch (e) {} });
  await p.route('**/api/**', r => {
    const u = r.request().url();
    const send = b => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.includes('login')) return send({ status: 'ok', token: 't', name: 'a', ist_admin: true });
    if (u.includes('dashboard_stats')) return send({ status: 'ok',
      kpi: { rapporte_monat: 0, rapporte_vormonat: 0, stunden_monat: 0, stunden_vormonat: 0,
             mitarbeiter: 1, kunden: 1, rapporte_total: 0 },
      verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [], sperr_ereignisse: [] });
    return send({ status: 'ok', einsaetze: [], kunden: [], rapporte: [], objekte: [],
      mitarbeiter: [], feiertage: [], gepflegt: {}, sperren: [] });
  });
  await p.goto(`file://${WURZEL}/dashboard.html`);
  await p.fill('#gName', 'a'); await p.fill('#gPass', 'x'); await p.click('#gBtn');
  await p.waitForSelector('#shell.on'); await p.waitForTimeout(500);
  const geheilt = await p.evaluate(() => {
    const stand = ordStand('uebersicht');
    const i = stand.findIndex(x => x.id === 'begruessung');
    return { breite: stand[i] && stand[i].breite, danach: stand[i + 1] && stand[i + 1].id,
             merker: localStorage.getItem('rv3_dash_zeit_umzug') };
  });
  check('KRITISCH: ein Merker der alten Stufe holt den Umzug nach',
    geheilt.breite === 'halb' && geheilt.danach === 'zeit');
  check('Und wird dabei auf die neue Stufe gehoben', geheilt.merker === '2');
  await p.close();
} catch (e) { bad.push('Alter Merker: ' + String(e).split('\n')[0].slice(0, 120)); }

// ══════════════════════════════ DAS KONTOMENUE AM LOGO
try {
  const p = await seite();
  await p.evaluate(() => huelleSetzen('aus'));
  await p.waitForTimeout(300);

  const zu = await p.evaluate(() => ({
    anzeige: getComputedStyle(document.querySelector('#sideFoot')).display,
    aria: document.getElementById('btnMarke').getAttribute('aria-expanded'),
  }));
  check('Zu Beginn ist das Menue geschlossen', zu.anzeige === 'none' && zu.aria === 'false');

  await p.click('#btnMarke'); await p.waitForTimeout(200);
  const auf = await p.evaluate(() => {
    const f = document.querySelector('#sideFoot');
    return { anzeige: getComputedStyle(f).display,
             aria: document.getElementById('btnMarke').getAttribute('aria-expanded'),
             // Reihenfolge auf dem Bildschirm, nicht im Markup: Der
             // Benutzerblock steht oben, das Abmelden unten -- gemacht mit
             // "order", damit das Markup und mit ihm test_wege.mjs stehen
             // bleiben konnte.
             reihe: [...f.children].filter(e => e.getBoundingClientRect().height > 0)
               .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
               .map(e => e.id || e.className) };
  });
  check('KRITISCH: ein Klick aufs Logo oeffnet es', auf.anzeige !== 'none' && auf.aria === 'true');
  check('KRITISCH: alle vier Eintraege der alten Symbolreihe sind darin',
    ['side-user', 'nav-einrichtung', 'nav-zurapp', 'nav-abmelden']
      .every(x => auf.reihe.some(r => r.includes(x))));
  check('Der Benutzerblock steht oben', auf.reihe[0].includes('side-user'));
  check('Und das Abmelden zuunterst', auf.reihe[auf.reihe.length - 1].includes('nav-abmelden'));
  check('Es traegt Namen und Rolle, nicht nur das Kuerzel',
    await p.evaluate(() => document.querySelector('#sideFoot .side-user .who')
      .getBoundingClientRect().height > 0));

  // Danebentippen, Escape und ein Klick IM Menue schliessen alle drei.
  await p.mouse.click(400, 500); await p.waitForTimeout(200);
  check('KRITISCH: danebentippen schliesst es',
    await p.evaluate(() => getComputedStyle(document.querySelector('#sideFoot')).display === 'none'));
  await p.click('#btnMarke'); await p.waitForTimeout(150);
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  check('Escape schliesst es ebenfalls',
    await p.evaluate(() => getComputedStyle(document.querySelector('#sideFoot')).display === 'none'));
  await p.click('#btnMarke'); await p.waitForTimeout(150);
  await p.click('#sideFoot #nav-einrichtung'); await p.waitForTimeout(250);
  check('KRITISCH: nach der Wahl eines Eintrags steht es nicht offen und verdeckt das Ergebnis',
    await p.evaluate(() => getComputedStyle(document.querySelector('#sideFoot')).display === 'none'));
  await p.evaluate(() => closeDlg('dlgEinrichtung'));

  // In den beiden Seitenleisten-Zustaenden steht der Fussteil ohnehin
  // sichtbar da. Ein Menue waere dort ein zweiter Weg zum selben Ziel --
  // der Knopf tut deshalb nichts, statt eine Klasse zu setzen, die man
  // nirgends sieht.
  await p.evaluate(() => huelleSetzen('voll')); await p.waitForTimeout(250);
  await p.click('#btnMarke'); await p.waitForTimeout(200);
  const inLeiste = await p.evaluate(() => ({
    klasse: document.getElementById('shell').classList.contains('menue-offen'),
    fussDa: document.querySelector('#sideFoot').getBoundingClientRect().height > 0,
  }));
  check('KRITISCH: in der Seitenleiste oeffnet das Logo kein zweites Menue', !inLeiste.klasse);
  check('Dort steht der Fussteil ohnehin sichtbar da', inLeiste.fussDa);

  // Und beim Wechsel zurueck bleibt kein offener Zustand haengen.
  await p.evaluate(() => huelleSetzen('aus')); await p.waitForTimeout(250);
  await p.click('#btnMarke'); await p.waitForTimeout(200);
  await p.evaluate(() => huelleSetzen('schmal')); await p.waitForTimeout(250);
  check('KRITISCH: ein Huellenwechsel laesst kein offenes Menue zurueck',
    await p.evaluate(() => !document.getElementById('shell').classList.contains('menue-offen')
      && document.getElementById('btnMarke').getAttribute('aria-expanded') === 'false'));
  await p.close();
} catch (e) { bad.push('Kontomenue: ' + String(e).split('\n')[0].slice(0, 120)); }

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
