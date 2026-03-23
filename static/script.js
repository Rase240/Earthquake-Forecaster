// Swapped to CartoDB Dark Matter base map for a modern dashboard look
const map = L.map("map", {
  worldCopyJump: false,
  maxBounds: [
    [-90, -180],
    [90, 180],
  ],
  maxBoundsViscosity: 1.0,
  zoomControl: false,
  attributionControl: false,
}).setView([20, 0], 2);

L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
  attribution: "&copy; OpenStreetMap & CartoDB",
}).addTo(map);

L.control.zoom({ position: "topright" }).addTo(map);

const quakeLayer = L.layerGroup().addTo(map);
const hotspotLayer = L.layerGroup().addTo(map);
const markerMap = new Map();

let showRecentQuakes = true;
let showHotspots = false;

// Custom UI Colors to match the new dark theme
const COLORS = {
  high: "#ef4444", // Tailwind Red
  medium: "#f59e0b", // Tailwind Amber
  low: "#3b82f6", // Tailwind Blue
};

const legend = L.control({ position: "bottomright" });
legend.onAdd = function () {
  const div = L.DomUtil.create("div", "info legend");
  div.innerHTML = `
        <h4 style="margin: 0 0 10px 0; font-size: 0.9rem; color: #f8fafc;">Risk Legend</h4>
        <div class="legend-item"><span class="legend-color" style="background: ${COLORS.high}"></span><span>High Risk (>70%)</span></div>
        <div class="legend-item"><span class="legend-color" style="background: ${COLORS.medium}"></span><span>Medium Risk (30–70%)</span></div>
        <div class="legend-item"><span class="legend-color" style="background: ${COLORS.low}"></span><span>Low Risk (<30%)</span></div>
    `;
  return div;
};
legend.addTo(map);

function getRiskColor(prediction) {
  if (prediction > 0.7) return COLORS.high;
  if (prediction > 0.3) return COLORS.medium;
  return COLORS.low;
}

function getRiskClass(prediction) {
  if (prediction > 0.7) return "high-risk";
  if (prediction > 0.3) return "medium-risk";
  return "low-risk";
}

function getMarkerSize(magnitude) {
  return Math.min(20, Math.max(5, magnitude * 2.5));
}

function createPopupContent(props) {
  const magnitude = props.mag?.toFixed(1) ?? "N/A";
  const depth = props.depth?.toFixed(1) ?? "N/A";
  const risk =
    props.prediction !== undefined
      ? `${(props.prediction * 100).toFixed(1)}%`
      : "N/A";

  return `
        <div class="quake-popup">
            <h3>${props.place || "Unknown Location"}</h3>
            <div class="popup-row"><span class="popup-label">Magnitude:</span><span class="popup-value" style="color: ${getRiskColor(props.prediction)}">${magnitude}</span></div>
            <div class="popup-row"><span class="popup-label">Depth:</span><span class="popup-value">${depth} km</span></div>
            <div class="popup-row"><span class="popup-label">Time:</span><span class="popup-value">${new Date(props.time).toLocaleString()}</span></div>
            <div class="popup-row"><span class="popup-label">AI Risk:</span><span class="popup-value risk-badge ${getRiskClass(props.prediction)}">${risk}</span></div>
        </div>`;
}

function showLoading(show) {
  const overlay = document.getElementById("loading-overlay");
  overlay.style.display = show ? "flex" : "none";
  document.getElementById("refresh-btn").disabled = show;
}

function updateStats(quakes) {
  document.getElementById("quake-count").textContent = quakes.length;
  if (quakes.length > 0) {
    const maxMag = Math.max(...quakes.map((q) => q.properties.mag));
    document.getElementById("max-mag").textContent = maxMag.toFixed(1);
    const highRiskCount = quakes.filter(
      (q) => q.properties.prediction > 0.7,
    ).length;
    document.getElementById("high-risk-count").textContent = highRiskCount;
  } else {
    document.getElementById("max-mag").textContent = "0.0";
    document.getElementById("high-risk-count").textContent = "0";
  }

  // Update timestamp
  document.getElementById("last-updated").textContent =
    `Last synced: ${new Date().toLocaleTimeString()}`;
}

function updateMapMarkers(features) {
  quakeLayer.clearLayers();
  markerMap.clear();

  if (!showRecentQuakes) return;

  features.forEach((quake) => {
    const coords = quake.geometry.coordinates;
    const props = quake.properties;
    const color = getRiskColor(props.prediction);

    const marker = L.circleMarker([coords[1], coords[0]], {
      radius: getMarkerSize(props.mag),
      fillColor: color,
      color: color,
      weight: 1,
      opacity: 0.8,
      fillOpacity: 0.6,
    }).addTo(quakeLayer);

    marker.feature = quake;
    marker.bindPopup(createPopupContent(props));

    const key = `${coords[1]}:${coords[0]}`;
    markerMap.set(key, marker);
  });
}

function updateQuakeList(quakes) {
  const list = document.getElementById("quake-list");
  list.innerHTML = "";

  const predictedQuakes = quakes.filter((q) => q.properties.prediction > 0.5);
  const recentQuakes = quakes.filter((q) => q.properties.prediction <= 0.5);

  if (predictedQuakes.length) {
    const predHeader = document.createElement("div");
    predHeader.className = "quake-section-header";
    predHeader.innerHTML =
      '<i class="fas fa-exclamation-triangle" style="color: var(--danger);"></i> Elevated Risk Zones';
    list.appendChild(predHeader);
    predictedQuakes.forEach((q) => list.appendChild(createQuakeItem(q, true)));
  }

  if (recentQuakes.length) {
    const recentHeader = document.createElement("div");
    recentHeader.className = "quake-section-header";
    recentHeader.innerHTML = '<i class="fas fa-history"></i> Recent Activity';
    list.appendChild(recentHeader);
    recentQuakes.forEach((q) => list.appendChild(createQuakeItem(q, false)));
  }
}

function createQuakeItem(quake, isPredicted) {
  const props = quake.properties;
  const coords = quake.geometry.coordinates;

  const item = document.createElement("div");
  item.className = `quake-item ${isPredicted ? "predicted-item" : ""}`;

  // Dynamic color block for the list
  const bgCol = getRiskColor(props.prediction);

  item.innerHTML = `
        <div class="magnitude-indicator" style="background-color: ${bgCol}; box-shadow: 0 0 10px ${bgCol}80;">
            ${props.mag.toFixed(1)}
        </div>
        <div class="quake-details">
            <div class="quake-location">${props.place || "Unknown Fault Line"}</div>
            <div class="quake-meta">
                <span>${new Date(props.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                <span style="color: ${bgCol}; font-weight: 600;">
                    ${(props.prediction * 100).toFixed(1)}% AI Risk
                </span>
            </div>
        </div>
    `;

  item.addEventListener("click", () => {
    const lat = coords[1],
      lng = coords[0];
    map.flyTo([lat, lng], 6, { duration: 1.5 });
    setTimeout(() => {
      markerMap.get(`${lat}:${lng}`)?.openPopup();
    }, 1500);
  });

  return item;
}

function loadEarthquakes() {
  showLoading(true);
  const days = document.getElementById("time-filter").value;
  const minMag = document.getElementById("magnitude-filter").value;

  fetch(`/api/earthquakes?days=${days}&min_mag=${minMag}`)
    .then((res) => res.json())
    .then((data) => {
      updateMapMarkers(data.features);
      updateQuakeList(data.features);
      updateStats(data.features);
      loadHotspots();
    })
    .catch((err) => console.error(err))
    .finally(() => showLoading(false));
}

function loadHotspots() {
  if (!showHotspots) return;
  fetch("/api/hotspots")
    .then((res) => res.json())
    .then((data) => {
      if (data.status === "success") updateHotspots(data.hotspots);
    });
}

function updateHotspots(hotspots) {
  hotspotLayer.clearLayers();
  hotspots.forEach((spot) => {
    const radius = Math.min(25, Math.max(10, spot.probability * 30));
    L.circleMarker([spot.latitude, spot.longitude], {
      radius,
      fillColor: COLORS.high,
      color: COLORS.high,
      weight: 0,
      opacity: 0.8,
      fillOpacity: 0.3,
      className: "hotspot-marker",
    }).addTo(hotspotLayer);
  });
}

function addToggleControls() {
  const toggle = L.control({ position: "topright" });
  toggle.onAdd = function () {
    const div = L.DomUtil.create("div", "toggle-controls");
    div.innerHTML = `
            <div style="margin-bottom: 8px;"><label style="cursor: pointer;"><input type="checkbox" id="toggle-quakes" checked> Live Quakes</label></div>
            <div><label style="cursor: pointer;"><input type="checkbox" id="toggle-hotspots"> Fault Hotspots</label></div>
        `;
    return div;
  };
  toggle.addTo(map);

  document.getElementById("toggle-quakes").addEventListener("change", (e) => {
    showRecentQuakes = e.target.checked;
    loadEarthquakes();
  });

  document.getElementById("toggle-hotspots").addEventListener("change", (e) => {
    showHotspots = e.target.checked;
    if (showHotspots) loadHotspots();
    else hotspotLayer.clearLayers();
  });
}

document
  .getElementById("refresh-btn")
  .addEventListener("click", loadEarthquakes);
document
  .getElementById("time-filter")
  .addEventListener("change", loadEarthquakes);
document
  .getElementById("magnitude-filter")
  .addEventListener("change", loadEarthquakes);

addToggleControls();
loadEarthquakes();

let lastClickTime = 0;
map.on("click", function (e) {
  const now = Date.now();
  if (now - lastClickTime < 1000) return;
  lastClickTime = now;

  const lat = e.latlng.lat.toFixed(4);
  const lng = e.latlng.lng.toFixed(4);

  document.getElementById("prediction-result").innerHTML =
    "Scanning coordinates...";

  fetch(`/api/predict?lat=${lat}&lon=${lng}`)
    .then((res) => res.json())
    .then((data) => {
      if (data.error) throw new Error(data.error);

      const riskClass = getRiskClass(data.probability);
      const content = `
                <strong style="color: var(--text-main);">Target Lock:</strong> [${lat}, ${lng}]<br>
                AI Risk Assessment: <span class="risk-badge ${riskClass}">${data.risk.toUpperCase()}</span><br>
                Confidence: <span style="color: ${getRiskColor(data.probability)}; font-weight:bold;">${(data.probability * 100).toFixed(1)}%</span>`;

      L.popup().setLatLng(e.latlng).setContent(content).openOn(map);
      document.getElementById("prediction-result").innerHTML = content;
    })
    .catch((err) => {
      document.getElementById("prediction-result").innerHTML =
        `<span style="color: var(--danger);">Scan failed</span>`;
    });
});

map.on("popupclose", () => {
  document.getElementById("prediction-result").innerHTML = "";
});
