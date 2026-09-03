// TESTUMGEBUNG-Kennzeichen (ENT-341).
//
// Erkennt Staging rein am Hostnamen -- dieselbe Unterscheidung wie
// ist_produktion() in backend/db.php, hier aber client-seitig: index.html,
// app.html und dashboard.html sind statische Dateien ohne Platzhalter-
// Ersetzung beim Deploy (siehe .github/workflows/deploy-hostpoint.yml),
// koennen also nicht aus einem Secret lesen. Ein falscher oder unbekannter
// Hostname zaehlt bewusst als "nicht Produktion" -- dieselbe sichere
// Richtung wie im Backend.
//
// Bewusst ein reiner Overlay-Hinweis statt eines Banners im Layoutfluss:
// eine feste Ecke mit pointer-events:none kann keine bestehende Kopfzeile,
// Werkzeugleiste oder Trefferflaeche verschieben oder verdecken -- auch
// nicht auf dem Handy, wo Bedienelemente laut CLAUDE.md mindestens 44px
// hoch sein muessen.
(function () {
  var PRODUKTIONS_DOMAIN = 'rapport.itufeden.myhostpoint.ch';
  if (location.hostname === PRODUKTIONS_DOMAIN) { return; }

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
