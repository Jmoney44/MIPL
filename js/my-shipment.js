const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzjE4WszH2PcKHfyVx1LvivESppOpOrwwrN8gOk8XDVzptm1cXxoEJ2cODdllGqSU_e/exec";
const AUTO_REFRESH_MS = 30000;

function loadLeaflet() {
  if (window.L) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.integrity = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
    script.crossOrigin = 'anonymous';
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

(async function () {
  try {
    await loadLeaflet();
  } catch {
    document.getElementById('pageBody').innerHTML = '<div class="state-msg">The shipment map could not be loaded. Please refresh the page and try again.</div>';
    return;
  }

  const STATUS_DESCRIPTIONS = {
    "picked up": "Shipment received for processing in Mexico.",
    "u.s. customs inspection": "Shipment stopped for customs inspection in the United States.",
    "in transit through united states": "Shipment is continuing through the United States toward Canada.",
    "canada customs inspection": "Shipment stopped for customs review in Canada.",
    "out for delivery": "Shipment is on its final delivery leg in Canada.",
    "delivered": "Shipment delivered to the recipient."
  };

  let currentId = null;
  let refreshTimer = null;

  function el(id) { return document.getElementById(id); }

  function fmtDate(str) {
    if (!str) return "—";
    const date = new Date(str);
    if (isNaN(date.getTime())) return str;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function fmtDateTime() {
    return new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }

  function showLookupBox() {
    el('pageBody').innerHTML = `
      <div class="lookup-box">
        <h2 style="font-size:20px; margin-bottom:6px;">View Your Shipment</h2>
        <p style="font-size:13.5px; color:#7A8792;">Enter the tracking number you received when you submitted your shipment.</p>
        <input type="text" id="lookupInput" placeholder="Enter your MIPL tracking number">
        <button class="btn btn-signal" id="lookupBtn" style="width:100%; justify-content:center;">View Shipment</button>
      </div>`;
    el('lookupBtn').addEventListener('click', () => {
      const value = el('lookupInput').value.trim();
      if (!value) return;
      const url = new URL(window.location.href);
      url.searchParams.set('id', value);
      window.location.href = url.toString();
    });
    el('lookupInput').addEventListener('keydown', event => {
      if (event.key === 'Enter') el('lookupBtn').click();
    });
  }

  function num(value) {
    const number = parseFloat(value);
    return isNaN(number) ? null : number;
  }

  let shipMap, shipOriginMarker, shipCurrentMarker, shipDestMarker, shipTraveled, shipRemaining;

  function renderShipMap(shipment) {
    const originLat = num(shipment.OriginLat), originLng = num(shipment.OriginLng);
    const currentLat = num(shipment.CurrentLat) ?? originLat, currentLng = num(shipment.CurrentLng) ?? originLng;
    const destLat = num(shipment.DestLat), destLng = num(shipment.DestLng);

    if (!shipMap) {
      shipMap = L.map('shipMap', { zoomControl: true, attributionControl: true }).setView([20, 0], 2);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18, attribution: '&copy; OpenStreetMap contributors'
      }).addTo(shipMap);
    }

    [shipOriginMarker, shipCurrentMarker, shipDestMarker, shipTraveled, shipRemaining].forEach(layer => {
      if (layer) shipMap.removeLayer(layer);
    });

    function icon(color, pulse) {
      if (pulse) {
        return L.divIcon({ className: '', html: `<div class="pulse-dot" style="background:${color};"></div>`, iconSize: [14, 14], iconAnchor: [7, 7] });
      }
      return L.divIcon({
        className: '',
        html: `<div style="width:16px;height:16px;border-radius:50%;background:${color};border:3px solid white;box-shadow:0 0 0 2px ${color};"></div>`,
        iconSize: [16, 16], iconAnchor: [8, 8]
      });
    }

    const bounds = [];
    if (originLat != null && originLng != null) {
      shipOriginMarker = L.marker([originLat, originLng], { icon: icon('#D6A12D') }).addTo(shipMap)
        .bindPopup(`<b>Origin</b><br>${shipment.OriginLabel || ''}`);
      bounds.push([originLat, originLng]);
    }
    if (currentLat != null && currentLng != null) {
      shipCurrentMarker = L.marker([currentLat, currentLng], { icon: icon('#1C8A5B', true) }).addTo(shipMap)
        .bindPopup(`<b>Current Location</b><br>${shipment.CurrentLabel || ''}`);
      bounds.push([currentLat, currentLng]);
    }
    if (destLat != null && destLng != null) {
      shipDestMarker = L.marker([destLat, destLng], { icon: icon('#16395C') }).addTo(shipMap)
        .bindPopup(`<b>Destination</b><br>${shipment.Destination || ''}`);
      bounds.push([destLat, destLng]);
    }
    if (originLat != null && currentLat != null) {
      shipTraveled = L.polyline([[originLat, originLng], [currentLat, currentLng]], { color: '#1C8A5B', weight: 3 }).addTo(shipMap);
    }
    if (currentLat != null && destLat != null) {
      shipRemaining = L.polyline([[currentLat, currentLng], [destLat, destLng]], { color: '#16395C', weight: 3, dashArray: '6 8' }).addTo(shipMap);
    }

    if (bounds.length > 1) shipMap.fitBounds(bounds, { padding: [36, 36] });
    else if (bounds.length === 1) shipMap.setView(bounds[0], 5);
  }

  function renderShipment(shipment) {
    if (shipMap) {
      shipMap.remove();
      shipMap = null;
      shipOriginMarker = shipCurrentMarker = shipDestMarker = shipTraveled = shipRemaining = null;
    }
    const statusKey = (shipment.Status || "").trim().toLowerCase();
    const description = STATUS_DESCRIPTIONS[statusKey] || "We'll update this as your shipment progresses.";

    el('pageBody').innerHTML = `
      <div class="ship-card">
        <div class="ship-card-head">
          <div>
            <span class="mono">TRACKING NUMBER</span>
            <h2>${shipment.TrackingNumber || ''}</h2>
          </div>
          <span class="status-pill"><span class="pulse-dot" style="width:8px;height:8px;"></span>${shipment.Status || '—'}</span>
        </div>
        <div class="ship-map-wrap">
          <div id="shipMap"></div>
          <div class="ship-map-legend">
            <span><span class="dot" style="background:#D6A12D;"></span>Origin</span>
            <span><span class="dot" style="background:#1C8A5B;"></span>Current</span>
            <span><span class="dot" style="background:#16395C;"></span>Destination</span>
          </div>
        </div>
        <table class="detail-table">
          <tr><td>Status</td><td>${description}</td></tr>
          <tr><td>Item Description</td><td>${shipment.Description || '—'}</td></tr>
          <tr><td>Unit / Quantity</td><td>${shipment.Unit || '—'}</td></tr>
          <tr><td>Description</td><td>${shipment.Note ? `<div class="note-box">${shipment.Note}</div>` : '—'}</td></tr>
          <tr><td>Service</td><td>${shipment.ServiceType || '—'}</td></tr>
          <tr><td>Origin</td><td>${shipment.OriginLabel || '—'}</td></tr>
          <tr><td>Current Location</td><td>${shipment.CurrentLabel || shipment.OriginLabel || '—'}</td></tr>
          <tr><td>Destination</td><td>${shipment.Destination || '—'}</td></tr>
          <tr><td>Estimated Delivery</td><td>${fmtDate(shipment.EstimatedDelivery)}</td></tr>
          <tr><td>Last Updated</td><td>${fmtDate(shipment.LastUpdated)}</td></tr>
        </table>
        <div class="ship-footer-row">
          <span class="live-indicator"><span class="dot"></span>Live — checked ${fmtDateTime()}</span>
          <button class="btn-refresh-lg" id="manualRefresh">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-2.6-6.3M21 4v5h-5"/></svg>
            Refresh Now
          </button>
        </div>
      </div>
      <p style="text-align:center; font-family:var(--font-mono); font-size:11.5px; color:#7A8792; margin-top:18px;">
        Bookmark this page — it always shows the latest status for ${shipment.TrackingNumber}.
      </p>`;

    el('manualRefresh').addEventListener('click', () => {
      el('manualRefresh').classList.add('spinning');
      loadShipment(currentId, true).then(() => {
        if (el('manualRefresh')) el('manualRefresh').classList.remove('spinning');
      });
    });
    renderShipMap(shipment);
  }

  function showNotFound(id) {
    el('pageBody').innerHTML = `
      <div class="lookup-box">
        <h2 style="font-size:20px; margin-bottom:6px; color:#B23A2E;">Not Found</h2>
        <p style="font-size:13.5px; color:#7A8792;">We couldn't find a shipment with tracking number <b>${id}</b>. Double-check it and try again, or contact us if the problem continues.</p>
        <button class="btn btn-navy" id="requestNewShipment" style="width:100%; justify-content:center; margin-top:14px;">Request a New Shipment</button>
      </div>`;
    el('requestNewShipment').addEventListener('click', () => {
      window.location.href = 'request-shipment.html';
    });
  }

  function loadShipment(id, isSilent) {
    if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.indexOf("PASTE_YOUR") === 0) {
      el('pageBody').innerHTML = `<div class="state-msg">Booking system isn't connected yet.</div>`;
      return Promise.resolve();
    }
    return fetch(APPS_SCRIPT_URL + '?id=' + encodeURIComponent(id))
      .then(response => response.json())
      .then(data => {
        if (data.success) renderShipment(data.shipment);
        else if (!isSilent) showNotFound(id);
      })
      .catch(() => {
        if (!isSilent) showNotFound(id);
      });
  }

  const params = new URLSearchParams(window.location.search);
  currentId = params.get('id');
  if (currentId) {
    loadShipment(currentId, false);
    refreshTimer = setInterval(() => loadShipment(currentId, true), AUTO_REFRESH_MS);
  } else {
    showLookupBox();
  }
})();