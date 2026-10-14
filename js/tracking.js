/* ==========================================================================
   MIPL — tracking page logic
   Live shipment data comes from a Google Apps Script Web App bound to the
   shipment tracking sheet (see Code.gs). Staff update a row's Status
   cell directly in the sheet; this page fetches that row live — no cache
   delay, unlike the old "publish to web" CSV approach.

   ---------------------------------------------------------------- SETUP ---
   1. Deploy Code.gs as a Web App (see instructions at the top of that
      file) and paste the resulting URL below as APPS_SCRIPT_URL.
   2. Status in the sheet must be exactly one of (case-insensitive):
        Picked Up | U.S. Customs Inspection | In Transit Through United States |
        Canada Customs Inspection | Out For Delivery | Delivered
   ========================================================================== */

const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwLVjUCpPmQArtPeKw-bex55GP9xDf3F7qPrKPuaMvhRf1xf3a_ETEEy9Oy2A8DLc4OLQ/exec";

(function(){

  const STAGE_ORDER = [
    { key:"picked_up",        title:"Picked Up in Mexico",              match:"picked up",                         desc:"Shipment received for processing in Mexico." },
    { key:"us_customs",       title:"U.S. Customs Inspection",           match:"u.s. customs inspection",            desc:"Shipment stopped for customs inspection in the United States." },
    { key:"in_transit",       title:"In Transit Through United States", match:"in transit through united states", desc:"Shipment is continuing through the United States toward Canada." },
    { key:"canada_customs",   title:"Canada Customs Inspection",         match:"canada customs inspection",          desc:"Shipment stopped for customs review in Canada." },
    { key:"out_for_delivery", title:"Out for Delivery in Canada",        match:"out for delivery",                   desc:"Shipment is on its final delivery leg in Canada." },
    { key:"delivered",        title:"Delivered",                        match:"delivered",                          desc:"Shipment delivered to the recipient." }
  ];

  let lastLookupId = null;
  let autoRefreshTimer = null;

  // ---------------------------------------------------------------- helpers

  function stageIndexFor(statusText){
    const q = (statusText || "").trim().toLowerCase();
    const idx = STAGE_ORDER.findIndex(s => s.match === q);
    return idx === -1 ? 0 : idx;
  }

  function num(v){
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
  }

  function rowToShipment(row){
    const origin = { label: row.OriginLabel || "Origin facility", lat: num(row.OriginLat), lng: num(row.OriginLng) };
    const current = { label: row.CurrentLabel || row.OriginLabel || "In transit", lat: num(row.CurrentLat) ?? origin.lat, lng: num(row.CurrentLng) ?? origin.lng };
    const destination = { label: row.Destination || "Destination address", lat: num(row.DestLat), lng: num(row.DestLng) };
    return {
      id: (row.TrackingNumber || "").trim(),
      reference: row.Reference || "",
      serviceType: row.ServiceType || "",
      status: row.Status || "Picked Up",
      origin, current, destination,
      eta: row.EstimatedDelivery || "",
      lastUpdated: row.LastUpdated || "",
      note: row.Note || ""
    };
  }

  // Fetches the live row for one tracking ID from the Apps Script endpoint.
  function fetchFromAppsScript(trackingId){
    if(!APPS_SCRIPT_URL || APPS_SCRIPT_URL.indexOf("PASTE_YOUR") === 0){
      return Promise.reject(new Error("Apps Script URL not configured yet"));
    }
    const url = APPS_SCRIPT_URL + "?id=" + encodeURIComponent(trackingId.trim());
    return fetch(url)
      .then(res => res.json())
      .then(data => {
        if(!data.success) return null;
        return rowToShipment(data.shipment);
      });
  }

  function findShipment(trackingId){
    return fetchFromAppsScript(trackingId).catch(err => {
      console.error("MIPL tracking: lookup failed for", trackingId, "—", err);
      return null;
    });
  }

  function fmtDate(str){
    if(!str) return "—";
    const d = new Date(str);
    if(isNaN(d.getTime())) return str;
    return d.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
  }

  // ---------------------------------------------------------------- map

  let map, originMarker, currentMarker, destMarker, traveledLine, remainingLine;

  function ensureMap(){
    if(map) return;
    map = L.map('trackMap', { zoomControl:true, attributionControl:true }).setView([20,0], 2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
  }

  function iconFor(color, pulse){
    if(pulse){
      return L.divIcon({
        className: '',
        html: `<div class="pulse-dot" style="background:${color};"></div>`,
        iconSize: [14,14], iconAnchor: [7,7]
      });
    }
    return L.divIcon({
      className: '',
      html: `<div style="width:16px;height:16px;border-radius:50%;background:${color};border:3px solid white;box-shadow:0 0 0 2px ${color};"></div>`,
      iconSize: [16,16], iconAnchor: [8,8]
    });
  }

  function renderMap(shipment){
    ensureMap();
    [originMarker, currentMarker, destMarker, traveledLine, remainingLine].forEach(l => { if(l) map.removeLayer(l); });

    const hasOrigin = shipment.origin.lat != null && shipment.origin.lng != null;
    const hasCurrent = shipment.current.lat != null && shipment.current.lng != null;
    const hasDest = shipment.destination.lat != null && shipment.destination.lng != null;

    const bounds = [];

    if(hasOrigin){
      originMarker = L.marker([shipment.origin.lat, shipment.origin.lng], { icon: iconFor('#D6A12D') })
        .addTo(map).bindPopup(`<b>Origin</b><br>${shipment.origin.label}`);
      bounds.push([shipment.origin.lat, shipment.origin.lng]);
    }
    if(hasCurrent){
      currentMarker = L.marker([shipment.current.lat, shipment.current.lng], { icon: iconFor('#1C8A5B', true) })
        .addTo(map).bindPopup(`<b>Current Location</b><br>${shipment.current.label}`);
      bounds.push([shipment.current.lat, shipment.current.lng]);
    }
    if(hasDest){
      destMarker = L.marker([shipment.destination.lat, shipment.destination.lng], { icon: iconFor('#16395C') })
        .addTo(map).bindPopup(`<b>Destination</b><br>${shipment.destination.label}`);
      bounds.push([shipment.destination.lat, shipment.destination.lng]);
    }

    if(hasOrigin && hasCurrent){
      traveledLine = L.polyline(
        [[shipment.origin.lat, shipment.origin.lng], [shipment.current.lat, shipment.current.lng]],
        { color:'#1C8A5B', weight:3 }
      ).addTo(map);
    }
    if(hasCurrent && hasDest){
      remainingLine = L.polyline(
        [[shipment.current.lat, shipment.current.lng], [shipment.destination.lat, shipment.destination.lng]],
        { color:'#16395C', weight:3, dashArray:'6 8' }
      ).addTo(map);
    }

    if(bounds.length > 1){
      map.fitBounds(bounds, { padding:[48,48] });
    } else if(bounds.length === 1){
      map.setView(bounds[0], 5);
    }

    document.getElementById('mapNote').textContent = shipment.lastUpdated
      ? `Last updated ${fmtDate(shipment.lastUpdated)}`
      : '';
  }

  // ---------------------------------------------------------------- render

  function renderResults(shipment){
    document.getElementById('sumId').textContent = shipment.id;
    document.getElementById('sumStatus').textContent = shipment.status;
    document.getElementById('sumOrigin').textContent = shipment.origin.label;
    document.getElementById('sumCurrent').textContent = shipment.current.label;
    document.getElementById('sumEta').textContent = fmtDate(shipment.eta);

    const currentIdx = stageIndexFor(shipment.status);
    const list = document.getElementById('stageList');
    list.innerHTML = '';
    STAGE_ORDER.forEach((stage, i) => {
      const status = i < currentIdx ? 'done' : (i === currentIdx ? 'current' : 'pending');
      const el = document.createElement('div');
      el.className = `stage ${status === 'done' ? 'done' : ''} ${status === 'current' ? 'current' : ''}`.trim();
      el.innerHTML = `
        <div class="stage-top">
          <h4>${stage.title}</h4>
          <time>${status === 'pending' ? 'Pending' : ''}</time>
        </div>
        <p>${stage.desc}${(i === currentIdx && shipment.note) ? ' — ' + shipment.note : ''}</p>`;
      list.appendChild(el);
    });

    document.getElementById('trackResults').classList.add('show');
    document.getElementById('trackError').classList.remove('show');
    renderMap(shipment);
    document.getElementById('results').scrollIntoView({ behavior:'smooth', block:'start' });
  }

  function showError(){
    document.getElementById('trackError').classList.add('show');
    document.getElementById('trackResults').classList.remove('show');
  }

  function lookupAndRender(id, isRefresh){
    const refreshBtn = document.getElementById('refreshBtn');
    if(isRefresh) refreshBtn.classList.add('spinning');
    findShipment(id).then(shipment => {
      if(isRefresh) refreshBtn.classList.remove('spinning');
      if(shipment){
        lastLookupId = id;
        renderResults(shipment);
      } else if(!isRefresh){
        showError();
      }
    }).catch(() => {
      if(isRefresh) refreshBtn.classList.remove('spinning');
      if(!isRefresh) showError();
    });
  }

  // ---------------------------------------------------------------- events

  document.getElementById('trackForm').addEventListener('submit', function(e){
    e.preventDefault();
    const id = document.getElementById('trackId').value.trim();
    if(!id) return;
    lookupAndRender(id, false);

    if(autoRefreshTimer) clearInterval(autoRefreshTimer);
    autoRefreshTimer = setInterval(() => {
      if(lastLookupId) lookupAndRender(lastLookupId, true);
    }, 60000);
  });

  document.getElementById('refreshBtn').addEventListener('click', function(){
    if(lastLookupId) lookupAndRender(lastLookupId, true);
  });

  document.querySelectorAll('[data-demo]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('trackId').value = btn.dataset.demo;
      document.getElementById('trackForm').requestSubmit();
    });
  });

  // If the page loads with ?id=MIPL-xxxxxxx-MXCA in the URL (e.g. linked from the
  // shipment request confirmation), auto-fill and look it up.
  const params = new URLSearchParams(window.location.search);
  const prefillId = params.get('id');
  if(prefillId){
    document.getElementById('trackId').value = prefillId;
    document.getElementById('trackForm').requestSubmit();
  }

})();
