// Initialize map with better defaults
const map = L.map('map', {
    worldCopyJump: false,
    maxBounds: [[-90, -180], [90, 180]],
    maxBoundsViscosity: 1.0,
    zoomControl: false,
    attributionControl: false
}).setView([20, 0], 2);

// Add tile layer with better visual contrast
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

// Add zoom control with better position
L.control.zoom({
    position: 'topright'
}).addTo(map);

// Add scale control
L.control.scale({
    position: 'bottomleft',
    imperial: false
}).addTo(map);

// Earthquake layer
const quakeLayer = L.layerGroup().addTo(map);

// Enhanced Legend
const legend = L.control({ position: 'bottomright' });
legend.onAdd = function(map) {
    const div = L.DomUtil.create('div', 'info legend');
    div.innerHTML = `
        <h4>Earthquake Legend</h4>
        <div class="legend-item">
            <span class="legend-color" style="background: #f72585"></span>
            <span>High Risk (>70%)</span>
        </div>
        <div class="legend-item">
            <span class="legend-color" style="background: #f8961e"></span>
            <span>Medium Risk (30-70%)</span>
        </div>
        <div class="legend-item">
            <span class="legend-color" style="background: #4cc9f0"></span>
            <span>Low Risk (<30%)</span>
        </div>
        <hr style="margin: 0.5rem 0; border-color: #eee">
        <div class="legend-item">
            <span class="magnitude-indicator" style="background: #f72585">6+</span>
            <span>High Magnitude</span>
        </div>
        <div class="legend-item">
            <span class="magnitude-indicator" style="background: #f8961e">4-6</span>
            <span>Medium Magnitude</span>
        </div>
        <div class="legend-item">
            <span class="magnitude-indicator" style="background: #4cc9f0">2.5-4</span>
            <span>Low Magnitude</span>
        </div>
    `;
    return div;
};
legend.addTo(map);

// Load earthquake data with filters
function loadEarthquakes() {
    showLoading(true);
    
    const days = document.getElementById('time-filter').value;
    const minMag = document.getElementById('magnitude-filter').value;
    
    fetch(`/api/earthquakes?days=${days}&min_mag=${minMag}`)
        .then(response => {
            if (!response.ok) throw new Error('Network response was not ok');
            return response.json();
        })
        .then(data => {
            if (data.error) throw new Error(data.error);
            
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

// Update stats panel
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

// Enhanced marker creation
function updateMapMarkers(features) {
    quakeLayer.clearLayers();
    
    features.forEach(quake => {
        const coords = quake.geometry.coordinates;
        const props = quake.properties;
        
        // Create custom icon based on magnitude
        const marker = L.circleMarker([coords[1], coords[0]], {
            radius: getMarkerSize(props.mag),
            fillColor: getRiskColor(props.prediction),
            color: '#000',
            weight: 1,
            opacity: 1,
            fillOpacity: 0.8
        }).addTo(quakeLayer);
        
        // Store feature data with marker
        marker.feature = quake;
        
        // Enhanced popup content
        marker.bindPopup(createPopupContent(props));
        
        // Pulse animation for significant quakes
        if (props.mag >= 6.0) {
            pulseMarker(marker);
        }
    });
}

// Enhanced earthquake list
function updateQuakeList(quakes) {
    const list = document.getElementById('quake-list');
    list.innerHTML = '';
    
    if (quakes.length === 0) {
        list.innerHTML = '<div class="empty-state">No earthquakes found for current filters</div>';
        return;
    }
    
    quakes.sort((a, b) => new Date(b.properties.time) - new Date(a.properties.time));
    
    quakes.forEach(quake => {
        const props = quake.properties;
        const coords = quake.geometry.coordinates;
        
        // Determine magnitude class
        let magClass = 'mag-low';
        if (props.mag >= 6.0) magClass = 'mag-high';
        else if (props.mag >= 4.0) magClass = 'mag-medium';
        
        const item = document.createElement('div');
        item.className = 'quake-item';
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
        
        // Click handler to focus on map
        item.addEventListener('click', () => {
            map.setView([coords[1], coords[0]], 8);
            quakeLayer.eachLayer(layer => {
                if (layer.getLatLng().lat === coords[1] && layer.getLatLng().lng === coords[0]) {
                    layer.openPopup();
                }
            });
        });
        
        list.appendChild(item);
    });
}

// Helper functions
function getMarkerSize(magnitude) {
    return Math.min(20, Math.max(5, magnitude * 2.5));
}

function getRiskColor(prediction) {
    if (prediction > 0.7) return '#f72585';  // danger
    if (prediction > 0.3) return '#f8961e';  // warning
    return '#4cc9f0';  // success
}

function getRiskClass(prediction) {
    if (prediction > 0.7) return 'high-risk';
    if (prediction > 0.3) return 'medium-risk';
    return 'low-risk';
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

function createPopupContent(props) {
    return `
        <div class="quake-popup">
            <h3>${props.place}</h3>
            <div class="popup-row">
                <span class="popup-label">Magnitude:</span>
                <span class="popup-value ${getMagnitudeClass(props.mag)}">${props.mag.toFixed(1)}</span>
            </div>
            <div class="popup-row">
                <span class="popup-label">Depth:</span>
                <span class="popup-value">${props.depth.toFixed(1)} km</span>
            </div>
            <div class="popup-row">
                <span class="popup-label">Time:</span>
                <span class="popup-value">${new Date(props.time).toLocaleString()}</span>
            </div>
            <div class="popup-row">
                <span class="popup-label">Risk:</span>
                <span class="popup-value ${getRiskClass(props.prediction)}">${(props.prediction * 100).toFixed(1)}%</span>
            </div>
        </div>
    `;
}

function getMagnitudeClass(mag) {
    if (mag >= 6) return 'high-risk';
    if (mag >= 4) return 'medium-risk';
    return 'low-risk';
}

function pulseMarker(marker) {
    let currentRadius = marker.options.radius;
    const originalRadius = currentRadius;
    
    const pulse = () => {
        currentRadius = currentRadius === originalRadius ? originalRadius * 1.3 : originalRadius;
        marker.setRadius(currentRadius);
    };
    
    const interval = setInterval(pulse, 1000);
    
    // Stop pulsing after 10 seconds
    setTimeout(() => {
        clearInterval(interval);
        marker.setRadius(originalRadius);
    }, 10000);
}

function showLoading(show) {
    const overlay = document.getElementById('loading-overlay');
    if (show) {
        overlay.style.display = 'flex';
        document.getElementById('refresh-btn').disabled = true;
    } else {
        overlay.style.display = 'none';
        document.getElementById('refresh-btn').disabled = false;
    }
}

function showError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.textContent = message;
    document.querySelector('.map-controls').appendChild(errorDiv);
    setTimeout(() => errorDiv.remove(), 5000);
}

function updateLastUpdated() {
    document.getElementById('last-updated').textContent = `Updated: ${new Date().toLocaleTimeString()}`;
}

// Event listeners
document.getElementById('refresh-btn').addEventListener('click', loadEarthquakes);
document.getElementById('time-filter').addEventListener('change', loadEarthquakes);
document.getElementById('magnitude-filter').addEventListener('change', loadEarthquakes);

// Initial load
loadEarthquakes();
// Handle map click to predict earthquake risk at clicked location
map.on('click', function (e) {
    const lat = e.latlng.lat.toFixed(4);
    const lng = e.latlng.lng.toFixed(4);

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
                    Probability: ${(data.probability * 100).toFixed(1)}%
                `;

                L.popup()
                    .setLatLng(e.latlng)
                    .setContent(content)
                    .openOn(map);

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

// Clear prediction info when popup closes
map.on('popupclose', () => {
    document.getElementById('prediction-result').innerHTML = '';
});
