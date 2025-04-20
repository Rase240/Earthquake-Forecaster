const map = L.map('map', {
    worldCopyJump: false,
    maxBounds: [[-90, -180], [90, 180]],
    maxBoundsViscosity: 1.0,
    zoomControl: false,
    attributionControl: false
}).setView([20, 0], 2);

L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

L.control.zoom({ position: 'topright' }).addTo(map);
L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);

const quakeLayer = L.layerGroup().addTo(map);
const hotspotLayer = L.layerGroup().addTo(map);
const markerMap = new Map();

let showRecentQuakes = true;
let showHotspots = false;

const legend = L.control({ position: 'bottomright' });
legend.onAdd = function () {
    const div = L.DomUtil.create('div', 'info legend');
    div.innerHTML = `
        <h4>Earthquake Legend</h4>
        <div class="legend-item"><span class="legend-color" style="background: #f72585"></span><span>High Risk (&gt;70%)</span></div>
        <div class="legend-item"><span class="legend-color" style="background: #f8961e"></span><span>Medium Risk (30–70%)</span></div>
        <div class="legend-item"><span class="legend-color" style="background: #4cc9f0"></span><span>Low Risk (&lt;30%)</span></div>
        <hr style="margin: 0.5rem 0; border-color: #eee">
        <div class="legend-item"><span class="magnitude-indicator" style="background: #f72585">6+</span><span>High Magnitude</span></div>
        <div class="legend-item"><span class="magnitude-indicator" style="background: #f8961e">4–6</span><span>Medium Magnitude</span></div>
        <div class="legend-item"><span class="magnitude-indicator" style="background: #4cc9f0">2.5–4</span><span>Low Magnitude</span></div>
    `;
    return div;
};
legend.addTo(map);

function getRiskColor(prediction) {
    if (prediction > 0.7) return '#f72585';
    if (prediction > 0.3) return '#f8961e';
    return '#4cc9f0';
}

function getRiskClass(prediction) {
    if (prediction > 0.7) return 'high-risk';
    if (prediction > 0.3) return 'medium-risk';
    return 'low-risk';
}

function getMarkerSize(magnitude) {
    return Math.min(20, Math.max(5, magnitude * 2.5));
}

function createPopupContent(props) {
    const magnitude = props.mag?.toFixed(1) ?? 'N/A';
    const depth = props.depth?.toFixed(1) ?? 'N/A';
    const risk = props.prediction !== undefined ? `${(props.prediction * 100).toFixed(1)}%` : 'N/A';

    return `
        <div class="quake-popup">
            <h3>${props.place || 'Unknown Location'}</h3>
            <div class="popup-row"><span class="popup-label">Magnitude:</span><span class="popup-value ${getRiskClass(props.prediction)}">${magnitude}</span></div>
            <div class="popup-row"><span class="popup-label">Depth:</span><span class="popup-value">${depth} km</span></div>
            <div class="popup-row"><span class="popup-label">Time:</span><span class="popup-value">${new Date(props.time).toLocaleString()}</span></div>
            <div class="popup-row"><span class="popup-label">Risk:</span><span class="popup-value ${getRiskClass(props.prediction)}">${risk}</span></div>
        </div>`;
}

function showLoading(show) {
    const overlay = document.getElementById('loading-overlay');
    overlay.style.display = show ? 'flex' : 'none';
    document.getElementById('refresh-btn').disabled = show;
}

function showError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.textContent = message;
    document.querySelector('.map-controls').appendChild(errorDiv);
    setTimeout(() => errorDiv.remove(), 5000);
}

function updateStats(quakes) {
    document.getElementById('quake-count').textContent = quakes.length;
    if (quakes.length > 0) {
        const maxMag = Math.max(...quakes.map(q => q.properties.mag));
        document.getElementById('max-mag').textContent = maxMag.toFixed(1);
        const highRiskCount = quakes.filter(q => q.properties.prediction > 0.7).length;
        document.getElementById('high-risk-count').textContent = highRiskCount;
    } else {
        document.getElementById('max-mag').textContent = '0.0';
        document.getElementById('high-risk-count').textContent = '0';
    }
}

function updateMapMarkers(features) {
    if (!showRecentQuakes) {
        quakeLayer.clearLayers();
        markerMap.clear();
        return;
    }

    quakeLayer.clearLayers();
    markerMap.clear();

    features.forEach(quake => {
        const coords = quake.geometry.coordinates;
        const props = quake.properties;

        const marker = L.circleMarker([coords[1], coords[0]], {
            radius: getMarkerSize(props.mag),
            fillColor: getRiskColor(props.prediction),
            color: '#000',
            weight: 1,
            opacity: 1,
            fillOpacity: 0.8
        }).addTo(quakeLayer);

        marker.feature = quake;
        marker.bindPopup(createPopupContent(props));

        const key = `${coords[1]}:${coords[0]}`;
        markerMap.set(key, marker);
    });
}

function updateQuakeList(quakes) {
    const list = document.getElementById('quake-list');
    list.innerHTML = '';

    const predictedQuakes = quakes.filter(q => q.properties.prediction > 0.5);
    const recentQuakes = quakes.filter(q => q.properties.prediction <= 0.5);

    if (predictedQuakes.length) {
        const predHeader = document.createElement('div');
        predHeader.className = 'quake-section-header';
        predHeader.textContent = '⚠️ Predicted Earthquakes';
        list.appendChild(predHeader);
        predictedQuakes.forEach(q => list.appendChild(createQuakeItem(q, true)));
    }

    if (recentQuakes.length) {
        const recentHeader = document.createElement('div');
        recentHeader.className = 'quake-section-header';
        recentHeader.textContent = '🕒 Recent Earthquakes';
        list.appendChild(recentHeader);
        recentQuakes.forEach(q => list.appendChild(createQuakeItem(q, false)));
    }

    if (!quakes.length) {
        list.innerHTML = '<div class="empty-state">No earthquakes found</div>';
    }
}

function createQuakeItem(quake, isPredicted) {
    const props = quake.properties;
    const coords = quake.geometry.coordinates;

    const item = document.createElement('div');
    item.className = `quake-item ${isPredicted ? 'predicted-item' : ''}`;
    item.innerHTML = `
        <div class="magnitude-indicator">${props.mag.toFixed(1)}</div>
        <div class="quake-details">
            <div class="quake-location">${props.place}</div>
            <div class="quake-meta">
                <span>${new Date(props.time).toLocaleTimeString()}</span>
                <span class="risk-badge ${getRiskClass(props.prediction)}">
                    ${(props.prediction * 100).toFixed(1)}% risk
                </span>
            </div>
        </div>
    `;

    item.addEventListener('click', () => {
        const lat = coords[1], lng = coords[0];
        map.setView([lat, lng], 8);
        markerMap.get(`${lat}:${lng}`)?.openPopup();
    });

    return item;
}

function loadEarthquakes() {
    showLoading(true);
    const days = document.getElementById('time-filter').value;
    const minMag = document.getElementById('magnitude-filter').value;

    fetch(`/api/earthquakes?days=${days}&min_mag=${minMag}`)
        .then(res => res.json())
        .then(data => {
            updateMapMarkers(data.features);
            updateQuakeList(data.features);
            updateStats(data.features);
            loadHotspots();
        })
        .catch(err => {
            console.error(err);
            showError('Failed to load earthquakes');
        })
        .finally(() => showLoading(false));
}

function loadHotspots() {
    if (!showHotspots) return;
    fetch('/api/hotspots')
        .then(res => res.json())
        .then(data => {
            if (data.status === 'success') updateHotspots(data.hotspots);
        })
        .catch(err => {
            console.error(err);
            showError('Failed to load hotspots');
        });
}

function updateHotspots(hotspots) {
    hotspotLayer.clearLayers();

    if (hotspots.length > 500) {
        hotspots = hotspots.filter(spot => spot.probability > 0.7);
    }

    hotspots.forEach(spot => {
        const radius = Math.min(15, Math.max(5, spot.probability * 20));
        const color = getRiskColor(spot.probability);

        L.circleMarker([spot.latitude, spot.longitude], {
            radius,
            fillColor: color,
            color: '#000',
            weight: 1,
            opacity: 0.7,
            fillOpacity: 0.5,
            className: 'hotspot-marker'
        }).addTo(hotspotLayer);
    });
}

function addToggleControls() {
    const toggle = L.control({ position: 'topright' });
    toggle.onAdd = function () {
        const div = L.DomUtil.create('div', 'toggle-controls');
        div.innerHTML = `
            <div class="toggle-control"><label><input type="checkbox" id="toggle-quakes" checked> Show Earthquakes</label></div>
            <div class="toggle-control"><label><input type="checkbox" id="toggle-hotspots"> Show Hotspots</label></div>
        `;
        return div;
    };
    toggle.addTo(map);

    document.getElementById('toggle-quakes').addEventListener('change', (e) => {
        showRecentQuakes = e.target.checked;
        loadEarthquakes();
    });

    document.getElementById('toggle-hotspots').addEventListener('change', (e) => {
        showHotspots = e.target.checked;
        if (showHotspots) loadHotspots();
        else hotspotLayer.clearLayers();
    });
}

document.getElementById('refresh-btn').addEventListener('click', loadEarthquakes);
document.getElementById('time-filter').addEventListener('change', loadEarthquakes);
document.getElementById('magnitude-filter').addEventListener('change', loadEarthquakes);

addToggleControls();
loadEarthquakes();

// Debounced map click
let lastClickTime = 0;
map.on('click', function (e) {
    const now = Date.now();
    if (now - lastClickTime < 1000) return;
    lastClickTime = now;

    const lat = e.latlng.lat.toFixed(4);
    const lng = e.latlng.lng.toFixed(4);

    fetch(`/api/predict?lat=${lat}&lon=${lng}`)
        .then(res => res.json())
        .then(data => {
            if (data.status === 'success') {
                const content = `
                    <strong>Prediction at clicked point:</strong><br>
                    Latitude: ${data.latitude.toFixed(4)}<br>
                    Longitude: ${data.longitude.toFixed(4)}<br>
                    Risk Level: <b>${data.risk.toUpperCase()}</b><br>
                    Probability: ${(data.probability * 100).toFixed(1)}%`;
                L.popup().setLatLng(e.latlng).setContent(content).openOn(map);
                document.getElementById('prediction-result').innerHTML = content;
            }
        })
        .catch(err => {
            console.error(err);
            showError('Prediction failed');
        });
});

map.on('popupclose', () => {
    document.getElementById('prediction-result').innerHTML = '';
});
