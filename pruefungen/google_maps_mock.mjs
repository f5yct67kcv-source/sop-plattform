// Testdouble fuer die Google Maps JavaScript API (ENT-269). Der Browser in
// dieser Umgebung hat kein echtes Internet (auch nicht ueber den
// Sitzungs-Proxy, geprueft) -- ein `**/maps.googleapis.com/**`-Abfangen mit
// einer selbst geschriebenen Notlage ist die einzige Moeglichkeit,
// dashboard.html hier ueberhaupt laufen zu lassen. Bildet nur die Teile der
// echten API nach, die dashboard.html tatsaechlich benutzt (Map/Marker/
// Circle/LatLngBounds/event-System/controls) -- kein vollstaendiger
// Nachbau, keine echte Kartenprojektion, keine echten Kartenkacheln.
//
// Geometrie: eine einfache, in sich konsistente lineare Umrechnung
// Pixel<->Koordinate (kein echtes Web-Mercator) -- reicht fuer alles, was
// die Pruefungen tatsaechlich brauchen (Klick setzt IRGENDeinen Punkt,
// Ziehen aendert ihn MESSBAR, programmatisch gesetzte Koordinaten kommen
// beim Auslesen exakt wieder heraus). Marker/Kreise sind echte, sichtbare
// DOM-Elemente mit eigenen Klassen (".gm-mock-*"), damit Pruefungen mit
// echten Playwright-Mausereignissen ziehen koennen, genau wie zuvor bei
// Leaflet.
export const GOOGLE_MAPS_MOCK = `
(function () {
  // Pixel je Grad, an die echte Web-Mercator-Kachelskala angelehnt
  // (256px * 2^zoom Weltbreite / 360 Grad) -- nicht geografisch korrekt
  // (keine Breitengrad-Verzerrung), aber realistisch genug skaliert, dass
  // nahe beieinanderliegende Punkte bei hohem Zoom nicht Tausende Pixel
  // auseinanderliegen. Eine fruehere, frei erfundene Formel (300 * 1.8^zoom)
  // waechst viel zu schnell und schob Marker bei Zoom 16 weit aus dem
  // sichtbaren Kartenausschnitt -- am gerenderten Zustand gefunden, nicht
  // angenommen.
  const SKALA = { get(zoom) { return (256 * Math.pow(2, zoom)) / 360; } };

  function listenbar() {
    const h = {};
    return {
      addListener(ev, cb) { (h[ev] = h[ev] || []).push(cb); return { remove() { h[ev] = (h[ev]||[]).filter(x => x !== cb); } }; },
      _feuern(ev, ...args) { (h[ev] || []).slice().forEach(cb => cb(...args)); },
    };
  }

  function machLatLng(lat, lng) { return { lat: () => lat, lng: () => lng }; }
  function alsLiteral(x) {
    if (x && typeof x.lat === 'function') return { lat: x.lat(), lng: x.lng() };
    return { lat: Number(x.lat), lng: Number(x.lng) };
  }

  class LatLngBounds {
    constructor() { this.minLat = null; this.maxLat = null; this.minLng = null; this.maxLng = null; }
    extend(p) {
      const { lat, lng } = alsLiteral(p);
      this.minLat = this.minLat === null ? lat : Math.min(this.minLat, lat);
      this.maxLat = this.maxLat === null ? lat : Math.max(this.maxLat, lat);
      this.minLng = this.minLng === null ? lng : Math.min(this.minLng, lng);
      this.maxLng = this.maxLng === null ? lng : Math.max(this.maxLng, lng);
      return this;
    }
    getCenter() { return machLatLng((this.minLat + this.maxLat) / 2, (this.minLng + this.maxLng) / 2); }
    isEmpty() { return this.minLat === null; }
  }

  class Kartending {
    constructor() { Object.assign(this, listenbar()); }
  }

  class Map extends Kartending {
    constructor(container, opts) {
      super();
      this.container = container;
      container.classList.add('gm-mock-map');
      container.style.position = container.style.position || 'relative';
      container.style.overflow = 'hidden';
      this._center = opts && opts.center ? alsLiteral(opts.center) : { lat: 0, lng: 0 };
      this._zoom = (opts && opts.zoom) || 8;
      this._objekte = new Set();
      this.controls = new Proxy({}, { get: (t, k) => (t[k] = t[k] || makeControlArray(this)) });
      container.addEventListener('click', e => {
        if (e.target !== container) return; // Marker/Kreis stoppen die Ausbreitung selbst
        const p = this._pixelZuLatLng(e.offsetX, e.offsetY);
        this._feuern('click', { latLng: machLatLng(p.lat, p.lng) });
      });
      // Rechtsklick (ENT-286, Geofence-Bereich zeichnen): echtes Kontextmenue
      // unterdrueckt, stattdessen dasselbe 'rightclick'-Ereignis wie bei der
      // echten Maps-API.
      container.addEventListener('contextmenu', e => {
        e.preventDefault();
        if (e.target !== container) return;
        const p = this._pixelZuLatLng(e.offsetX, e.offsetY);
        this._feuern('rightclick', { latLng: machLatLng(p.lat, p.lng) });
      });
    }
    setCenter(c) { this._center = alsLiteral(c); this._neuPositionieren(); }
    getCenter() { return machLatLng(this._center.lat, this._center.lng); }
    setZoom(z) { this._zoom = z; this._neuPositionieren(); }
    getZoom() { return this._zoom; }
    panTo(c) { this.setCenter(c); }
    fitBounds(bounds, _padding) {
      if (bounds.isEmpty()) return;
      const mitte = bounds.getCenter();
      this._center = { lat: mitte.lat(), lng: mitte.lng() };
      const spanne = Math.max(bounds.maxLat - bounds.minLat, bounds.maxLng - bounds.minLng);
      this._zoom = spanne > 0.05 ? 11 : 16;
      this._neuPositionieren();
      setTimeout(() => this._feuern('idle'), 0);
    }
    _skala() { return SKALA.get(this._zoom); }
    _latLngZuPixel(lat, lng) {
      const r = this.container.getBoundingClientRect();
      const s = this._skala();
      return { x: r.width / 2 + (lng - this._center.lng) * s, y: r.height / 2 - (lat - this._center.lat) * s };
    }
    _pixelZuLatLng(x, y) {
      const r = this.container.getBoundingClientRect();
      const s = this._skala();
      return { lat: this._center.lat - (y - r.height / 2) / s, lng: this._center.lng + (x - r.width / 2) / s };
    }
    _registrieren(o) { this._objekte.add(o); this._neuPositionieren(); }
    _entfernen(o) { this._objekte.delete(o); }
    _neuPositionieren() { this._objekte.forEach(o => o._neuZeichnen()); }
  }

  function makeControlArray(map) {
    const arr = [];
    arr.push = function (el) {
      Array.prototype.push.call(arr, el);
      el.style.position = 'absolute';
      el.style.zIndex = '5';
      el.style.top = (10 + (arr.length - 1) * 40) + 'px';
      el.style.left = '10px';
      map.container.appendChild(el);
      return arr.length;
    };
    return arr;
  }

  class Marker extends Kartending {
    constructor(opts) {
      super();
      this._pos = alsLiteral(opts.position);
      this.draggable = !!opts.draggable;
      this.el = document.createElement('div');
      this.el.className = 'gm-mock-marker';
      this.el.style.cssText = 'position:absolute;width:24px;height:24px;margin-left:-12px;margin-top:-24px;'
        + 'border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#ea4335;cursor:pointer;z-index:10;';
      this.el.addEventListener('click', e => { e.stopPropagation(); this._feuern('click'); });
      this._ziehenEinrichten();
      this.setMap(opts.map || null);
    }
    setPosition(p) { this._pos = alsLiteral(p); this._neuZeichnen(); }
    getPosition() { return machLatLng(this._pos.lat, this._pos.lng); }
    setMap(map) {
      if (this._map) { this._map._entfernen(this); this.el.remove(); }
      this._map = map;
      if (map) { map.container.appendChild(this.el); map._registrieren(this); }
    }
    _neuZeichnen() {
      if (!this._map) return;
      const p = this._map._latLngZuPixel(this._pos.lat, this._pos.lng);
      this.el.style.left = p.x + 'px'; this.el.style.top = p.y + 'px';
    }
    _ziehenEinrichten() {
      let ziehend = false;
      this.el.addEventListener('mousedown', e => {
        if (!this.draggable) return;
        e.preventDefault(); e.stopPropagation(); ziehend = true;
      });
      document.addEventListener('mousemove', e => {
        if (!ziehend || !this._map) return;
        const r = this._map.container.getBoundingClientRect();
        const p = this._map._pixelZuLatLng(e.clientX - r.left, e.clientY - r.top);
        this._pos = p; this._neuZeichnen();
        this._feuern('drag');
      });
      document.addEventListener('mouseup', () => {
        if (!ziehend) return;
        ziehend = false;
        this._feuern('dragend');
      });
    }
  }

  class Circle extends Kartending {
    constructor(opts) {
      super();
      this._center = alsLiteral(opts.center);
      this._radius = opts.radius;
      this.el = document.createElement('div');
      this.el.className = 'gm-mock-circle';
      const farbe = opts.fillColor || '#7c3aed';
      this.el.style.cssText = 'position:absolute;width:26px;height:26px;margin-left:-13px;margin-top:-13px;'
        + 'border-radius:50%;cursor:pointer;background:' + farbe + ';opacity:.45;z-index:1;'
        + 'border:2px solid ' + (opts.strokeColor || farbe) + ';';
      this.el.addEventListener('click', e => { e.stopPropagation(); this._feuern('click'); });
      this.setMap(opts.map || null);
    }
    setCenter(p) { this._center = alsLiteral(p); this._neuZeichnen(); }
    getCenter() { return machLatLng(this._center.lat, this._center.lng); }
    setRadius(r) { this._radius = r; }
    getRadius() { return this._radius; }
    setMap(map) {
      if (this._map) { this._map._entfernen(this); this.el.remove(); }
      this._map = map;
      if (map) { map.container.appendChild(this.el); map._registrieren(this); }
    }
    _neuZeichnen() {
      if (!this._map) return;
      const p = this._map._latLngZuPixel(this._center.lat, this._center.lng);
      this.el.style.left = p.x + 'px'; this.el.style.top = p.y + 'px';
    }
  }

  // Vieleck (ENT-286, Geofence-Bereiche): eigenes SVG-Overlay statt eines
  // einzelnen div wie bei Circle -- ein Vieleck braucht eine variable Anzahl
  // Ecken, dafuer reicht ein div mit fester Form nicht. Reales, sichtbares
  // DOM-Element mit eigener Klasse (".gm-mock-polygon"), gleiches Prinzip
  // wie Marker/Circle.
  class Polygon extends Kartending {
    constructor(opts) {
      super();
      this._path = (opts.paths || opts.path || []).map(alsLiteral);
      this.el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      this.el.setAttribute('class', 'gm-mock-polygon');
      this.el.style.cssText = 'position:absolute;left:0;top:0;overflow:visible;pointer-events:none;z-index:2;';
      this._poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      // clickable:false (wie in der echten API) laesst Klicks durch --
      // sonst wuerde eine im Entstehen befindliche Zeichen-Vorschau, sobald
      // sie schon eine Flaeche hat, jeden weiteren Kartenklick abfangen, der
      // zufaellig innerhalb dieser Flaeche liegt (z.B. eine Ecke nach innen
      // setzen, um ein konkaves Vieleck zu zeichnen) -- der Klick kaeme dann
      // nie beim Map-Container an.
      this._poly.style.pointerEvents = opts.clickable === false ? 'none' : 'auto';
      this._poly.style.cursor = 'pointer';
      this._poly.setAttribute('fill', opts.fillColor || '#22c55e');
      this._poly.setAttribute('fill-opacity', opts.fillOpacity != null ? opts.fillOpacity : 0.35);
      this._poly.setAttribute('stroke', opts.strokeColor || opts.fillColor || '#22c55e');
      this._poly.setAttribute('stroke-width', String(opts.strokeWeight || 2));
      this._poly.addEventListener('click', e => { e.stopPropagation(); this._feuern('click'); });
      this.el.appendChild(this._poly);
      this.setMap(opts.map || null);
    }
    setPath(path) { this._path = (path.getArray ? path.getArray() : path).map(alsLiteral); this._neuZeichnen(); }
    getPath() {
      const arr = this._path.map(p => machLatLng(p.lat, p.lng));
      arr.getArray = () => arr;
      return arr;
    }
    setMap(map) {
      if (this._map) { this._map._entfernen(this); this.el.remove(); }
      this._map = map;
      if (map) { map.container.appendChild(this.el); map._registrieren(this); }
    }
    _neuZeichnen() {
      if (!this._map) return;
      const r = this._map.container.getBoundingClientRect();
      this.el.setAttribute('width', String(r.width));
      this.el.setAttribute('height', String(r.height));
      const pts = this._path.map(p => {
        const px = this._map._latLngZuPixel(p.lat, p.lng);
        return px.x + ',' + px.y;
      }).join(' ');
      this._poly.setAttribute('points', pts);
    }
  }

  const ereignis = {
    trigger(ziel, ev, ...args) { ziel._feuern(ev, ...args); },
    addListener(ziel, ev, cb) { return ziel.addListener(ev, cb); },
    addListenerOnce(ziel, ev, cb) {
      const eintrag = ziel.addListener(ev, (...a) => { eintrag.remove(); cb(...a); });
      return eintrag;
    },
  };

  window.google = window.google || {};
  window.google.maps = {
    Map, Marker, Circle, Polygon, LatLngBounds,
    ControlPosition: { LEFT_TOP: 'LEFT_TOP', TOP_LEFT: 'TOP_LEFT', RIGHT_TOP: 'RIGHT_TOP' },
    event: ereignis,
  };
})();
`;
