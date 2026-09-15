// Klapp-Menü für die Seitenleiste auf dem Handy. Auf dem Desktop greift
// die Regel in handbuch.css gar nicht erst (siehe @media dort) — dieses
// Skript ist dann folgenlos.
(function () {
  var btn = document.getElementById('hbMenuBtn');
  var side = document.getElementById('hbSide');
  if (!btn || !side) { return; }
  btn.addEventListener('click', function () {
    var offen = side.classList.toggle('offen');
    btn.setAttribute('aria-expanded', offen ? 'true' : 'false');
  });
})();
