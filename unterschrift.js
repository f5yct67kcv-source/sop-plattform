/* Unterschrift des Kunden -- ein Knopf, dann der ganze Bildschirm (ENT-292).
 *
 * VORHER: ein 160 px hohes Feld mitten im Formular. Zwei Dinge stimmten daran
 * nicht. Erstens die Groesse -- wer darin unterschreibt, schreibt auf
 * Briefmarkenformat, und die Unterschrift sieht danach aus. Zweitens, und das
 * war das eigentliche Problem: Ein leeres, kleines Rechteck sieht nicht nach
 * "hier bitte unterschreiben" aus. Es wurde bedient, indem man hineintippte
 * und schaute, was passiert.
 *
 * JETZT: im Formular steht nur ein Knopf. Beim Antippen uebernimmt das Blatt
 * den ganzen Bildschirm, der Kunde unterschreibt, bestaetigt -- und der
 * Rapport laeuft normal weiter. Der Knopf traegt danach die Vorschau.
 *
 * QUER, NICHT HOCHKANT. Eine Unterschrift ist breit; hochkant waere der Platz
 * an der falschen Seite. Erzwingen laesst sich die Geraetedrehung im Browser
 * aber nicht: screen.orientation.lock() gibt es in Safari/iOS gar nicht (auf
 * Android nur im Vollbild) -- und unterschrieben wird auf dem iPhone. Deshalb
 * wird nicht das Geraet gedreht, sondern das Blatt: haelt man das Handy
 * hochkant, steht die Flaeche um 90 Grad gedreht, und man MUSS quer halten,
 * um darauf zu schreiben. Dreht das Geraet die Seite selbst mit (Drehsperre
 * aus, Safari im Reiter), entfaellt die Drehung -- sonst stuende alles doppelt
 * gedreht. Entschieden wird das gemessen (innerWidth/innerHeight), nicht ueber
 * eine Media-Query, damit CSS und Zeichenlogik nicht auseinanderlaufen koennen:
 * die Umrechnung der Fingerposition haengt an derselben Antwort.
 *
 * EINE DATEI FUER BEIDE OBERFLAECHEN (index.html, app.html), wie gav.js und
 * zeitwahl.js (ENT-110). Zwei Kopien waeren zwei verschiedene Unterschriften,
 * je nachdem, ueber welchen Weg der Kunde unterschreibt -- und beim naechsten
 * Mal wuerde nur eine davon geaendert.
 *
 * GESPEICHERT WIRD NUR DER STRICH, nicht das Papier. Die Blattoptik ist
 * Hintergrund im CSS, das PNG traegt einen durchsichtigen Grund und ist auf die
 * Unterschrift zugeschnitten. Sonst haetten Rapportliste, Kundenblatt und PDF
 * ploetzlich eine graue Flaeche mit Perforation unter der Unterschrift, und
 * jedes Bild waere so gross wie der Bildschirm, auf dem es entstand.
 */
window.Unterschrift = (function () {
  'use strict';

  const FARBE = '#1A1D23';
  const STRICH = 2.4;            // CSS-Pixel auf dem Blatt
  const EXPORT_BREITE = 1400;    // Breite des ganzen Blattes im gespeicherten Bild
  const RAND = 18;               // Luft um die Unterschrift beim Zuschnitt

  // Striche als Punktfolgen, normiert auf 0..1 des Blattes -- nicht als
  // Pixel. Dreht der Kunde das Geraet mitten im Unterschreiben, wird die
  // Leinwand neu vermessen; aus Pixeln waere die Unterschrift dann weg.
  let striche = [];
  let laufend = null;
  let bild = null;               // bestaetigte Unterschrift als data:-URL
  let ziel = null;
  let kontext = () => ({});

  let voll, buehne, blatt, leinwand, ctx, hinweis, kopfWert, nameZeile, okKnopf;

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const CSS = `
.usig-cta { display: inline-flex; align-items: center; justify-content: center; gap: 9px;
  min-height: 52px; padding: 0 22px; border-radius: 11px; border: 1.5px dashed #B9C4DA;
  background: #F7F9FD; color: #2F5BD7; font: inherit; font-size: 15px; font-weight: 700;
  cursor: pointer; -webkit-tap-highlight-color: transparent; }
.usig-cta:hover { background: #EDF2FE; border-color: #2F5BD7; }
.usig-cta .usig-feder { font-size: 17px; }

.usig-fertig { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.usig-vorschau { height: 54px; max-width: 190px; background: #fff; border: 1px solid #E5E8EC;
  border-radius: 8px; padding: 4px 8px; object-fit: contain; }
.usig-etikett { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .7px;
  color: #8B919D; }
.usig-fertig-wert { font-size: 15px; font-weight: 700; color: #0E7C55; margin-top: 2px; }
.usig-fertig-wert small { display: block; font-size: 12.5px; font-weight: 600; color: #8B919D;
  margin-top: 1px; }
.usig-knoepfe { display: flex; gap: 8px; margin-left: auto; }
.usig-klein { min-height: 44px; padding: 0 14px; border-radius: 9px; border: 1px solid #E5E8EC;
  background: #fff; color: #14161A; font: inherit; font-size: 13.5px; font-weight: 650; cursor: pointer; }
.usig-klein.usig-weg { color: #C2382A; }

/* Ueber allem: Anmeldeschirm (1000), Schublade und Modalfenster liegen
   darunter -- der Kunde soll beim Unterschreiben nichts anderes sehen. */
.usig-voll { position: fixed; inset: 0; z-index: 1100; background: #16181D; display: none;
  overflow: hidden; overscroll-behavior: contain; }
.usig-voll.usig-auf { display: block; }
.usig-buehne { position: absolute; top: 0; left: 0; transform-origin: top left; box-sizing: border-box;
  display: flex; flex-direction: column; gap: 10px; padding: 12px 16px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #F3F5F8; }

.usig-kopf { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px;
  flex: 0 0 auto; }
.usig-kopf .usig-etikett { color: #9298A5; }
.usig-kopf-wert { font-size: 15px; font-weight: 650; color: #F3F5F8; margin-top: 2px; }
.usig-dreh { font-size: 12.5px; font-weight: 600; color: #9298A5; display: none; }
.usig-buehne[data-gedreht="1"] .usig-dreh { display: block; }

/* Das Blatt: weisses Papier mit Abrisskante oben und Unterschriftslinie
   unten. Reine Optik -- gespeichert wird nur der Strich (siehe Kopf). */
.usig-blatt { position: relative; flex: 1 1 auto; min-height: 0; background: #fff;
  border-radius: 3px; overflow: hidden;
  box-shadow: 0 12px 28px rgba(0,0,0,.45), 0 0 0 1px rgba(0,0,0,.25); }
.usig-blatt::before { content: ''; position: absolute; left: 0; right: 0; top: 0; height: 15px;
  background:
    radial-gradient(circle at 11px 7px, rgba(0,0,0,.15) 0 2.6px, transparent 2.8px) 0 0 / 22px 15px repeat-x,
    linear-gradient(#F2F0EA, #FCFBF9);
  border-bottom: 1px dashed #DCD8CF; }
.usig-linie { position: absolute; left: 7%; right: 7%; bottom: 24%; border-bottom: 1.5px solid #1A1D23; }
.usig-kreuz { position: absolute; left: 0; bottom: 4px; font-size: 15px; font-weight: 700; color: #1A1D23; }
.usig-unterzeile { position: absolute; left: 7%; right: 7%; bottom: calc(24% - 20px);
  font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .6px; color: #9AA0AC; }
.usig-hinweis { position: absolute; left: 0; right: 0; bottom: 30%; text-align: center;
  font-size: 15px; font-weight: 600; color: #C4C9D4; }
.usig-blatt canvas { position: absolute; inset: 0; touch-action: none; cursor: crosshair; }

.usig-fuss { display: flex; align-items: center; gap: 10px; flex: 0 0 auto; }
.usig-btn { min-height: 48px; padding: 0 20px; border-radius: 10px; border: 1px solid #2C313A;
  background: #1E2128; color: #F3F5F8; font: inherit; font-size: 15px; font-weight: 650;
  cursor: pointer; -webkit-tap-highlight-color: transparent; }
.usig-btn-ok { margin-left: auto; background: #0E7C55; border-color: #0E7C55; }
.usig-btn-ok[disabled] { opacity: .4; cursor: default; }
`;

  function huelleBauen() {
    if (voll) { return; }
    const stil = document.createElement('style');
    stil.id = 'usigStil';
    stil.textContent = CSS;
    document.head.appendChild(stil);

    voll = document.createElement('div');
    voll.className = 'usig-voll';
    voll.id = 'usigVoll';
    voll.innerHTML = `
      <div class="usig-buehne" id="usigBuehne">
        <div class="usig-kopf">
          <div>
            <div class="usig-etikett">Unterschrift Kunde</div>
            <div class="usig-kopf-wert" id="usigKontext"></div>
          </div>
          <div class="usig-dreh">Gerät quer halten</div>
        </div>
        <div class="usig-blatt" id="usigBlatt">
          <div class="usig-hinweis" id="usigHinweis">✍ Hier unterschreiben</div>
          <div class="usig-linie"><span class="usig-kreuz">✕</span></div>
          <div class="usig-unterzeile" id="usigName"></div>
          <canvas id="usigCanvas"></canvas>
        </div>
        <div class="usig-fuss">
          <button type="button" class="usig-btn" id="usigAbbruch">Abbrechen</button>
          <button type="button" class="usig-btn" id="usigLoeschen">Löschen</button>
          <button type="button" class="usig-btn usig-btn-ok" id="usigOk" disabled>✓ Bestätigen</button>
        </div>
      </div>`;
    document.body.appendChild(voll);

    buehne   = voll.querySelector('#usigBuehne');
    blatt    = voll.querySelector('#usigBlatt');
    leinwand = voll.querySelector('#usigCanvas');
    hinweis  = voll.querySelector('#usigHinweis');
    kopfWert = voll.querySelector('#usigKontext');
    nameZeile = voll.querySelector('#usigName');
    okKnopf  = voll.querySelector('#usigOk');

    voll.querySelector('#usigAbbruch').addEventListener('click', schliessen);
    voll.querySelector('#usigLoeschen').addEventListener('click', leeren);
    okKnopf.addEventListener('click', bestaetigen);

    leinwand.addEventListener('pointerdown', zugAn);
    leinwand.addEventListener('pointermove', zugWeiter);
    leinwand.addEventListener('pointerup', zugAus);
    leinwand.addEventListener('pointercancel', zugAus);

    window.addEventListener('resize', () => {
      if (!voll.classList.contains('usig-auf')) { return; }
      massnehmen(); malen();
    });
    window.addEventListener('orientationchange', () => {
      if (!voll.classList.contains('usig-auf')) { return; }
      setTimeout(() => { massnehmen(); malen(); }, 120);
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && voll.classList.contains('usig-auf')) { schliessen(); }
    });
  }

  // Buehne und Leinwand auf den tatsaechlichen Bildschirm bringen. Hochkant
  // wird die Buehne gedreht (siehe Kopf); gemessen statt per Media-Query,
  // weil dieselbe Antwort auch die Fingerposition umrechnet.
  function massnehmen() {
    const quer = window.innerWidth >= window.innerHeight;
    buehne.style.width  = (quer ? window.innerWidth : window.innerHeight) + 'px';
    buehne.style.height = (quer ? window.innerHeight : window.innerWidth) + 'px';
    buehne.style.transform = quer ? 'none' : 'rotate(90deg) translateY(-100%)';
    buehne.dataset.gedreht = quer ? '0' : '1';

    // clientWidth/clientHeight sind die Layoutmasse und bleiben von der
    // Drehung des Vorfahren unberuehrt -- getBoundingClientRect waere hier
    // gedreht und damit vertauscht.
    const b = blatt.clientWidth, h = blatt.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    leinwand.width  = Math.max(1, Math.round(b * dpr));
    leinwand.height = Math.max(1, Math.round(h * dpr));
    leinwand.style.width  = b + 'px';
    leinwand.style.height = h + 'px';
    ctx = leinwand.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = FARBE; ctx.lineWidth = STRICH;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  }

  // Fingerposition -> Punkt auf dem Blatt (0..1). Ist die Buehne gedreht,
  // liegt die Bildschirm-Y-Achse auf der X-Achse des Blattes.
  function punkt(e) {
    const r = leinwand.getBoundingClientRect();
    const b = leinwand.clientWidth || 1, h = leinwand.clientHeight || 1;
    const gedreht = buehne.dataset.gedreht === '1';
    const x = gedreht ? (e.clientY - r.top) : (e.clientX - r.left);
    const y = gedreht ? (r.right - e.clientX) : (e.clientY - r.top);
    const klemm = v => Math.min(1, Math.max(0, v));
    return [klemm(x / b), klemm(y / h)];
  }

  function zugAn(e) {
    e.preventDefault();
    if (leinwand.setPointerCapture) { try { leinwand.setPointerCapture(e.pointerId); } catch (x) { /* egal */ } }
    laufend = [punkt(e)];
    striche.push(laufend);
    ctx.beginPath();
    ctx.moveTo(laufend[0][0] * leinwand.clientWidth, laufend[0][1] * leinwand.clientHeight);
    ctx.lineTo(laufend[0][0] * leinwand.clientWidth + 0.01, laufend[0][1] * leinwand.clientHeight);
    ctx.stroke();
    aktualisieren();
  }

  function zugWeiter(e) {
    if (!laufend) { return; }
    e.preventDefault();
    const vorher = laufend[laufend.length - 1];
    const jetzt = punkt(e);
    laufend.push(jetzt);
    const b = leinwand.clientWidth, h = leinwand.clientHeight;
    ctx.beginPath();
    ctx.moveTo(vorher[0] * b, vorher[1] * h);
    ctx.lineTo(jetzt[0] * b, jetzt[1] * h);
    ctx.stroke();
  }

  function zugAus() { laufend = null; }

  function malen() {
    const b = leinwand.clientWidth, h = leinwand.clientHeight;
    ctx.clearRect(0, 0, b, h);
    striche.forEach(s => {
      if (!s.length) { return; }
      ctx.beginPath();
      ctx.moveTo(s[0][0] * b, s[0][1] * h);
      if (s.length === 1) { ctx.lineTo(s[0][0] * b + 0.01, s[0][1] * h); }
      else { for (let i = 1; i < s.length; i++) { ctx.lineTo(s[i][0] * b, s[i][1] * h); } }
      ctx.stroke();
    });
  }

  function aktualisieren() {
    hinweis.style.display = striche.length ? 'none' : '';
    okKnopf.disabled = !striche.length;
  }

  function leeren() {
    striche = []; laufend = null;
    malen(); aktualisieren();
  }

  function oeffnen() {
    huelleBauen();
    const k = kontext() || {};
    kopfWert.textContent = k.zeile || '';
    nameZeile.textContent = k.name || '';
    voll.classList.add('usig-auf');
    document.body.style.overflow = 'hidden';
    massnehmen();
    malen();
    aktualisieren();
  }

  function schliessen() {
    if (!voll) { return; }
    voll.classList.remove('usig-auf');
    document.body.style.overflow = '';
    laufend = null;
  }

  function bestaetigen() {
    if (!striche.length) { return; }
    bild = bildErzeugen();
    schliessen();
    karteZeichnen();
  }

  // Nur die Unterschrift, zugeschnitten und in fester Groesse -- unabhaengig
  // davon, wie gross der Bildschirm war, auf dem sie entstand.
  function bildErzeugen() {
    if (!striche.length) { return null; }
    const b = leinwand.clientWidth || 1, h = leinwand.clientHeight || 1;
    const m = EXPORT_BREITE / b;                       // Massstab Blatt -> Bild
    const px = v => v * b * m, py = v => v * h * m;
    let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
    striche.forEach(s => s.forEach(p => {
      if (p[0] < x0) { x0 = p[0]; } if (p[0] > x1) { x1 = p[0]; }
      if (p[1] < y0) { y0 = p[1]; } if (p[1] > y1) { y1 = p[1]; }
    }));
    const strich = STRICH * m;
    const luft = RAND + strich;
    const lx = Math.max(0, px(x0) - luft), ly = Math.max(0, py(y0) - luft);
    const rx = Math.min(px(1), px(x1) + luft), ry = Math.min(py(1), py(y1) + luft);
    const c = document.createElement('canvas');
    c.width  = Math.max(2, Math.round(rx - lx));
    c.height = Math.max(2, Math.round(ry - ly));
    const k = c.getContext('2d');
    k.strokeStyle = FARBE; k.lineWidth = strich; k.lineCap = 'round'; k.lineJoin = 'round';
    striche.forEach(s => {
      if (!s.length) { return; }
      k.beginPath();
      k.moveTo(px(s[0][0]) - lx, py(s[0][1]) - ly);
      if (s.length === 1) { k.lineTo(px(s[0][0]) - lx + 0.01, py(s[0][1]) - ly); }
      else { for (let i = 1; i < s.length; i++) { k.lineTo(px(s[i][0]) - lx, py(s[i][1]) - ly); } }
      k.stroke();
    });
    return c.toDataURL('image/png');
  }

  // Im Formular steht entweder der Knopf oder die erfasste Unterschrift --
  // nie beides und nie ein leeres Feld, das aussieht wie ein Fehler.
  function karteZeichnen() {
    if (!ziel) { return; }
    if (!bild) {
      ziel.innerHTML = '<button type="button" class="usig-cta" id="usigCta">'
        + '<span class="usig-feder">✍</span>Unterschrift hinzufügen</button>';
      ziel.querySelector('#usigCta').addEventListener('click', oeffnen);
      return;
    }
    const k = kontext() || {};
    ziel.innerHTML = `
      <div class="usig-fertig">
        <img class="usig-vorschau" id="usigVorschau" alt="Unterschrift des Kunden" src="${bild}">
        <div>
          <div class="usig-etikett">Unterschrift</div>
          <div class="usig-fertig-wert">✓ Erfasst${k.name ? `<small>${esc(k.name)}</small>` : ''}</div>
        </div>
        <div class="usig-knoepfe">
          <button type="button" class="usig-klein" id="usigNeu">Ändern</button>
          <button type="button" class="usig-klein usig-weg" id="usigWeg">Entfernen</button>
        </div>
      </div>`;
    ziel.querySelector('#usigNeu').addEventListener('click', oeffnen);
    ziel.querySelector('#usigWeg').addEventListener('click', () => {
      bild = null; striche = []; karteZeichnen();
    });
  }

  return {
    // ziel: Kennung oder Element, in das Knopf bzw. Vorschau kommen.
    // kontext: () => ({ zeile, name }) -- was der Kunde beim Unterschreiben
    // sieht. Als Funktion, weil Kunde und Name sich im Formular noch aendern,
    // nachdem eingerichtet wurde.
    einrichten(o) {
      huelleBauen();
      ziel = typeof o.ziel === 'string' ? document.getElementById(o.ziel) : o.ziel;
      kontext = o.kontext || (() => ({}));
      striche = []; laufend = null; bild = null;
      schliessen();
      karteZeichnen();
    },
    daten() { return bild; },
    gesetzt() { return !!bild; },
    zuruecksetzen() { striche = []; laufend = null; bild = null; karteZeichnen(); },
  };
})();
