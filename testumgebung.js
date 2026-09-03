// TESTUMGEBUNG-Kennzeichen (ENT-341, verschaerft auf Wunsch des
// Projektinhabers).
//
// Explizit beim Deploy gesetzt -- derselbe Platzhalter, den auch
// backend/db.php traegt (dieselbe sed-Zeile im Deploy-Workflow ersetzt
// __APP_ENV__ in BEIDEN Dateien) -- NICHT aus dem Hostnamen abgeleitet.
// Dieselbe Begruendung wie bei ist_produktion() in backend/db.php: ein
// Hostname kann anders ankommen, als die Umgebung tatsaechlich ist: der
// Deploy-Lauf selbst weiss es zweifelsfrei.
//
// Fail-safe: der Hinweis erscheint bei JEDEM Wert ausser dem exakten
// "production" -- ein leerer oder unersetzter Platzhalter zeigt ihn also
// eher zu oft als zu selten. Das ist die sichere Richtung: der Hinweis ist
// nur eine Anzeige, kein Sicherheitsmechanismus, aber er soll nie in
// Produktion und nie faelschlich verschwinden.
//
// Bewusst ein reiner Overlay-Hinweis statt eines Banners im Layoutfluss:
// eine feste Ecke mit pointer-events:none kann keine bestehende Kopfzeile,
// Werkzeugleiste oder Trefferflaeche verschieben oder verdecken -- auch
// nicht auf dem Handy, wo Bedienelemente laut CLAUDE.md mindestens 44px
// hoch sein muessen.
(function () {
  var APP_ENV = '__APP_ENV__';
  if (APP_ENV === 'production') { return; }

  var hinweis = document.createElement('div');
  hinweis.textContent = 'TESTUMGEBUNG';
  hinweis.setAttribute('role', 'status');
  hinweis.setAttribute('aria-label', 'Testumgebung -- keine echten Geschäftsdaten');
  hinweis.style.cssText = [
    'position:fixed', 'right:10px', 'bottom:10px', 'z-index:2147483647',
    'background:#7a4fae', 'color:#fff',
    'font:700 11px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
    'letter-spacing:.06em', 'padding:6px 10px', 'border-radius:999px',
    'box-shadow:0 2px 8px rgba(0,0,0,.25)', 'pointer-events:none',
  ].join(';');

  function einfuegen() { document.body.appendChild(hinweis); }
  if (document.body) { einfuegen(); } else { document.addEventListener('DOMContentLoaded', einfuegen); }
})();
