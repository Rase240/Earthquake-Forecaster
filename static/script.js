// script.js — synced sidebar with predicted section and map markers

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
const markerMap = new Map();

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

function createPopupContent(props) {
    const depth = typeof props.depth === 'number' ? props.depth.toFixed(1) : 'N/A';
    const magnitude = typeof props.mag === 'number' ? props.mag.toFixed(1) : 'N/A';
    const risk = props.prediction !== undefined ? `${(props.prediction * 100).toFixed(1)}%` : 'N/A';

    return `
        <div class="quake-popup">
            <h3>${props.place || 'Unknown Location'}</h3>
            <div class="popup-row"><span class="popup-label">Magnitude:</span><span class="popup-value ${getMagnitudeClass(props.mag)}">${magnitude}</span></div>
            <div class="popup-row"><span class="popup-label">Depth:</span><span class="popup-value">${depth} km</span></div>
            <div class="popup-row"><span class="popup-label">Time:</span><span class="popup-value">${new Date(props.time).toLocaleString()}</span></div>
            <div class="popup-row"><span class="popup-label">Risk:</span><span class="popup-value ${getRiskClass(props.prediction)}">${risk}</span></div>
        </div>`;
}

function getMagnitudeClass(mag) {
    if (mag >= 6) return 'high-risk';
    if (mag >= 4) return 'medium-risk';
    return 'low-risk';
}

function getRiskClass(prediction) {
    if (prediction > 0.7) return 'high-risk';
    if (prediction > 0.3) return 'medium-risk';
    return 'low-risk';
}

function getRiskColor(prediction) {
    if (prediction > 0.7) return '#f72585';
    if (prediction > 0.3) return '#f8961e';
    return '#4cc9f0';
}

function getMarkerSize(magnitude) {
    return Math.min(20, Math.max(5, magnitude * 2.5));
}

function formatTimeAgo(timestamp) {
    const seconds = Math.floor((new Date() - new Date(timestamp)) / 1000);
    if (seconds < 60) return `${seconds} seconds ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? '' : 's'} ago`;
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

        if (props.mag >= 6.0) pulseMarker(marker);

        const key = `${coords[1]}:${coords[0]}`;
        markerMap.set(key, marker);
    });
}

function pulseMarker(marker) {
    let currentRadius = marker.options.radius;
    const originalRadius = currentRadius;
    const pulse = () => {
        currentRadius = currentRadius === originalRadius ? originalRadius * 1.3 : originalRadius;
        marker.setRadius(currentRadius);
    };
    const interval = setInterval(pulse, 1000);
    setTimeout(() => {
        clearInterval(interval);
        marker.setRadius(originalRadius);
    }, 10000);
}

function updateQuakeList(quakes) {
    const list = document.getElementById('quake-list');
    list.innerHTML = '';

    const predictedQuakes = quakes.filter(q => q.properties.prediction > 0.5);
    const recentQuakes = quakes.filter(q => q.properties.prediction <= 0.5);

    if (predictedQuakes.length > 0) {
        const predHeader = document.createElement('div');
        predHeader.className = 'quake-section-header';
        predHeader.textContent = '⚠️ Predicted Earthquakes';
        list.appendChild(predHeader);

        predictedQuakes.forEach(q => list.appendChild(createQuakeItem(q, true)));
    }

    if (recentQuakes.length > 0) {
        const recentHeader = document.createElement('div');
        recentHeader.className = 'quake-section-header';
        recentHeader.textContent = '🕒 Recent Earthquakes';
        list.appendChild(recentHeader);

        recentQuakes.forEach(q => list.appendChild(createQuakeItem(q, false)));
    }

    if (quakes.length === 0) {
        list.innerHTML = '<div class="empty-state">No earthquakes found for current filters</div>';
    }
}

function createQuakeItem(quake, isPredicted) {
    const props = quake.properties;
    const coords = quake.geometry.coordinates;
    let magClass = 'mag-low';
    if (props.mag >= 6.0) magClass = 'mag-high';
    else if (props.mag >= 4.0) magClass = 'mag-medium';

    const item = document.createElement('div');
    item.className = `quake-item ${isPredicted ? 'predicted-item' : ''}`;
    item.innerHTML = `
        <div class="magnitude-indicator ${magClass}">${props.mag.toFixed(1)}</div>
        <div class="quake-details">
            <div class="quake-location">${props.place}</div>
            <div class="quake-meta">
                <span>${formatTimeAgo(props.time)}</span>
                <span class="risk-badge ${getRiskClass(props.prediction)}">
                    ${(props.prediction * 100).toFixed(1)}% risk
                </span>
            </div>
        </div>
    `;

    item.addEventListener('click', () => {
        const lat = coords[1];
        const lng = coords[0];
        const key = `${lat}:${lng}`;
        const marker = markerMap.get(key);
        if (marker) {
            map.setView([lat, lng], 8);
            marker.openPopup();
            pulseMarker(marker);
        }
    });

    return item;
}

function updateLastUpdated() {
    document.getElementById('last-updated').textContent = `Updated: ${new Date().toLocaleTimeString()}`;
}

function loadEarthquakes() {
    showLoading(true);
    const days = document.getElementById('time-filter').value;
    const minMag = document.getElementById('magnitude-filter').value;
    fetch(`/api/earthquakes?days=${days}&min_mag=${minMag}`)
        .then(response => response.json())
        .then(data => {
            updateLastUpdated();
            updateMapMarkers(data.features);
            updateQuakeList(data.features);
            updateStats(data.features);
        })
        .catch(error => {
            console.error('Error:', error);
            showError(error.message);
        })
        .finally(() => showLoading(false));
}

document.getElementById('refresh-btn').addEventListener('click', loadEarthquakes);
document.getElementById('time-filter').addEventListener('change', loadEarthquakes);
document.getElementById('magnitude-filter').addEventListener('change', loadEarthquakes);

loadEarthquakes();

let clickedMarker;
map.on('click', function (e) {
    const lat = e.latlng.lat.toFixed(4);
    const lng = e.latlng.lng.toFixed(4);

    if (clickedMarker) map.removeLayer(clickedMarker);

    clickedMarker = L.circleMarker(e.latlng, {
        radius: 8,
        fillColor: '#ff4d6d',
        color: '#000',
        weight: 2,
        opacity: 1,
        fillOpacity: 0.8,
        className: 'clicked-marker'
    }).addTo(map);

    showLoading(true);
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
            } else {
                showError('Prediction failed: ' + data.message);
            }
        })
        .catch(err => {
            console.error('Prediction error:', err);
            showError('Prediction request failed.');
        })
        .finally(() => showLoading(false));
});

map.on('popupclose', () => {
    document.getElementById('prediction-result').innerHTML = '';
});