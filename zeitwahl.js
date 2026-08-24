/* ══════════════════════════════════════════════════════════════════════════
   ZEITWAHL — gemeinsam für Verwaltung (dashboard.html) und
   Mitarbeiter-App (app.html). ENT-110.

   Eine Uhrzeit wird gewählt, nicht getippt: zwei Auswahlfelder statt eines
   freien Feldes. In der Planung stehen nur Viertelstunden zur Wahl — so wird
   geplant, und die krumme Zahl entsteht gar nicht erst.

   Ist-Zeiten sind ausgenommen (data-zeit="fein"): Was jemand tatsächlich
   gearbeitet hat, ist keine Planungsgrösse. Daraus entstehen Lohn und
   Rechnung, und 07:07 auf 07:00 zu runden wäre eine Rundungsregel — die
   gehört entschieden, nicht nebenbei eingebaut.

   WARUM EINE DATEI: Dasselbe Bedienelement muss sich in beiden Oberflächen
   gleich verhalten. Zwei Kopien driften auseinander, sobald eine davon
   angefasst wird — genau so ist der globale Sprechen-Dialog ohne
   Bild-Erkennung stehengeblieben (ENT-107). Auch das Aussehen liegt darum
   hier und nicht in den beiden HTML-Dateien.

   Fehlt diese Datei im Deploy, bleiben alle Zeitfelder unsichtbar und keine
   Zeit lässt sich mehr eintragen — derselbe Fallstrick wie bei gav.js
   (ENT-049). Die Prüfung test_deploy.mjs wacht darüber.
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
'use strict';

// Aussehen bringt die Komponente selbst mit -- sonst müsste dieselbe Regel in
// zwei HTML-Dateien gepflegt werden.
const STIL = `
.zeitwahl { display: inline-flex; align-items: center; gap: 4px; width: 100%; min-width: 0; }
.zeitwahl select { flex: 1 1 0; min-width: 0; text-align: center; }
.zeitwahl-tr { color: var(--ink-3, #8B919D); font-weight: 600; flex: none; }
@media (max-width: 720px) { .zeitwahl select { min-height: 44px; font-size: 16px; } }
`;

const ZEITWAHL_SCHRITT = 15;

function zeitwahlMinuten(fein, aktuell) {
  const schritt = fein ? 1 : ZEITWAHL_SCHRITT;
  const liste = [];
  for (let m = 0; m < 60; m += schritt) liste.push(m);
  // Ein bereits gespeicherter Wert ausserhalb des Rasters bleibt waehlbar.
  // Sonst verschoebe allein das Oeffnen eines Dialogs eine 07:07 still auf
  // 07:00 -- eine Aenderung, die niemand vorgenommen hat.
  if (aktuell != null && !liste.includes(aktuell)) liste.push(aktuell);
  return liste.sort((a, b) => a - b);
}

function zeitwahlFuellen(el) {
  const huelle = el.__zw;
  if (!huelle) return;
  const wert = String(el.value || '').slice(0, 5);
  const [hh, mm] = wert.includes(':') ? wert.split(':').map(Number) : [null, null];
  const fein = el.dataset.zeit === 'fein';
  const opt = (w, t, gewaehlt) => `<option value="${w}"${gewaehlt ? ' selected' : ''}>${t}</option>`;
  const zwei = n => String(n).padStart(2, '0');
  huelle.std.innerHTML = opt('', '––', hh == null)
    + Array.from({ length: 24 }, (_, h) => opt(zwei(h), zwei(h), h === hh)).join('');
  huelle.min.innerHTML = opt('', '––', mm == null)
    + zeitwahlMinuten(fein, mm).map(m => opt(zwei(m), zwei(m), m === mm)).join('');
}

// Aus den beiden Auswahlfeldern zurueck ins urspruengliche Feld. Erst wenn
// beide gesetzt sind, entsteht eine Uhrzeit -- eine halbe ist keine.
function zeitwahlUebernehmen(el) {
  const huelle = el.__zw;
  const h = huelle.std.value, m = huelle.min.value;
  const neu = (h && m) ? `${h}:${m}` : '';
  if (neu === String(el.value || '')) return;
  el.__zwStill = true;
  el.value = neu;
  el.__zwStill = false;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function zeitwahlBauen(el) {
  if (el.__zw) return;
  const fein = el.dataset.zeit === 'fein';
  const huelle = document.createElement('span');
  huelle.className = 'zeitwahl';
  const bau = (art, beschriftung) => {
    const s = document.createElement('select');
    s.className = 'inp';
    s.setAttribute('aria-label', `${el.getAttribute('aria-label') || el.id || 'Zeit'} — ${beschriftung}`);
    if (el.disabled) s.disabled = true;
    s.addEventListener('change', () => zeitwahlUebernehmen(el));
    huelle[art] = s;
    return s;
  };
  el.parentNode.insertBefore(huelle, el);
  huelle.appendChild(bau('std', 'Stunde'));
  const trenner = document.createElement('span');
  trenner.className = 'zeitwahl-tr';
  trenner.textContent = ':';
  huelle.appendChild(trenner);
  huelle.appendChild(bau('min', fein ? 'Minute' : 'Viertelstunde'));
  huelle.appendChild(el);
  el.type = 'hidden';
  el.__zw = huelle;

  // Ein `.value = ...` aus dem uebrigen Code muss die Auswahlfelder
  // mitnehmen. Ein Zuweisen loest von sich aus kein Ereignis aus, darum wird
  // der Zugriff hier abgefangen statt auf ein Ereignis gewartet.
  const urspruenglich = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  Object.defineProperty(el, 'value', {
    configurable: true,
    get() { return urspruenglich.get.call(el); },
    set(v) { urspruenglich.set.call(el, v); if (!el.__zwStill) zeitwahlFuellen(el); },
  });
  zeitwahlFuellen(el);
}

// Auch fuer alles, was erst spaeter entsteht -- die Abgleich-Tabelle baut
// ihre Zeitfelder bei jedem Zeichnen neu. Ein vergessener Aufruf an einer
// einzelnen Stelle hinterliesse sonst ein Feld, das sich anders bedient als
// alle uebrigen.
function zeitwahlAnwenden(wurzel) {
  (wurzel || document).querySelectorAll('input[type="time"]').forEach(zeitwahlBauen);
}

function zeitwahlStarten() {
  zeitwahlAnwenden(document);
  new MutationObserver(muts => {
    for (const m of muts) {
      for (const k of m.addedNodes) {
        if (k.nodeType !== 1) continue;
        if (k.matches && k.matches('input[type="time"]')) zeitwahlBauen(k);
        else if (k.querySelectorAll) zeitwahlAnwenden(k);
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
}
function zeitwahlStil() {
  if (document.getElementById('zeitwahl-stil')) return;
  const s = document.createElement('style');
  s.id = 'zeitwahl-stil';
  s.textContent = STIL;
  document.head.appendChild(s);
}

function zeitwahlLos() { zeitwahlStil(); zeitwahlStarten(); }
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', zeitwahlLos);
} else zeitwahlLos();

// Fuer den seltenen Fall, dass eine Oberflaeche ein Zeitfeld ausserhalb des
// Dokumentbaums aufbaut und selbst nachziehen muss.
window.zeitwahlAnwenden = zeitwahlAnwenden;
})();
