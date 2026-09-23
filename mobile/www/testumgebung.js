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
// ZWEI TEXTE, EIN MECHANISMUS (ENT-523): "demo" bekommt eine eigene,
// zurueckhaltende Marke statt des Warnaufklebers -- ein Interessent soll
// sich nicht wie in einer kaputten Testumgebung fuehlen. Jeder andere
// Wert (auch "staging" und jeder unbekannte/unersetzte Platzhalter) faellt
// auf den bestehenden TESTUMGEBUNG-Hinweis zurueck -- dieselbe fail-safe-
// Richtung wie oben: ein neuer, noch unbekannter Umgebungswert soll eher
// zu auffaellig warnen als lautlos gar nichts zeigen.
//
// Bewusst ein reiner Overlay-Hinweis statt eines Banners im Layoutfluss:
// eine feste Ecke mit pointer-events:none kann keine bestehende Kopfzeile,
// Werkzeugleiste oder Trefferflaeche verschieben oder verdecken -- auch
// nicht auf dem Handy, wo Bedienelemente laut CLAUDE.md mindestens 44px
// hoch sein muessen.
//
// Farbe/Text der Demo-Marke sind noch NICHT am gerenderten Zustand
// gemessen (CLAUDE.md: "gemessen, nicht nachgelesen") -- es gibt noch
// keine deploybare Demo-Instanz, an der sich das pruefen liesse. Vor der
// ersten echten Vorfuehrung nachholen.
(function () {
  var APP_ENV = 'production';
  // Fuer den Assistenten (ENT-699): Er erscheint nur ausserhalb von
  // Produktion und Demo. VOR dem return gesetzt, damit auch Produktion den
  // Wert traegt -- sonst saehe "production" im Cockpit aus wie "unbekannt".
  // Die massgebliche Sperre steht im Server (ki_assistent_erlaubt()).
  window.APP_UMGEBUNG = APP_ENV;
  if (APP_ENV === 'production') { return; }

  var istDemo = APP_ENV === 'demo';

  // Fuer Gestaltung, die dem Schild unten rechts ausweichen muss (etwa das
  // Update-Blatt am Handy, ENT-698): Das Schild liegt ueber allem und laesst
  // sich nicht wegschieben -- also weicht, was darunter laege.
  document.documentElement.classList.add('mit-umgebungsschild');

  // Fuer andere Skripte auf derselben Seite lesbar, z. B. den Gruss auf der
  // Anmeldemaske in dashboard.html -- ohne eigene __APP_ENV__-Ersetzung dort
  // anzulegen, die die Deploy-sed-Zeile (siehe oben) erst noch kennen muesste.
  window.APP_UMGEBUNG_DEMO = istDemo;

  // Zweite, engere Unterscheidung INNERHALB von "demo" (Befund des
  // Projektinhabers, 2026-09-21): APP_ENV=demo traegt sowohl die eine
  // ENT-523-Demo-Umgebung (gemeinsamer Zugang, naechtliches Leeren) als
  // auch jeden der zehn Demo-Plaetze (ENT-600/601: eigene Datenbank,
  // 14 Tage, ein Interessent). Beide brauchen denselben Warnaufkleber
  // oben, aber unterschiedliche Rechtstexte (dashboard.html) -- darum ein
  // EIGENER Platzhalter statt eines geratenen Unterschieds aus der
  // Adresse. Eigene Ersetzung im Deploy je Demo-Platz (deploy-hostpoint.yml);
  // ueberall sonst bleibt sie "0" -- fail-safe: ein unersetzter oder
  // falscher Wert zeigt weiterhin den bisherigen ENT-523-Text, keinen
  // neuen.
  var IST_DEMO_PLATZ = '__IST_DEMO_PLATZ__';
  window.APP_UMGEBUNG_DEMO_PLATZ = istDemo && IST_DEMO_PLATZ === '1';

  var hinweis = document.createElement('div');
  hinweis.textContent = istDemo ? 'DEMO — BEISPIELDATEN' : 'TESTUMGEBUNG';
  hinweis.setAttribute('role', 'status');
  hinweis.setAttribute('aria-label', istDemo
    ? 'Demo-Umgebung -- Beispieldaten, keine echten Geschäftsdaten'
    : 'Testumgebung -- keine echten Geschäftsdaten');
  hinweis.style.cssText = [
    'position:fixed', 'right:10px', 'bottom:10px', 'z-index:2147483647',
    'background:' + (istDemo ? '#0E7C66' : '#7a4fae'), 'color:#fff',
    'font:700 11px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
    'letter-spacing:.06em', 'padding:6px 10px', 'border-radius:999px',
    'box-shadow:0 2px 8px rgba(0,0,0,.25)', 'pointer-events:none',
  ].join(';');

  function einfuegen() { document.body.appendChild(hinweis); }
  if (document.body) { einfuegen(); } else { document.addEventListener('DOMContentLoaded', einfuegen); }
})();
