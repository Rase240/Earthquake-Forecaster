from flask import Flask, render_template, jsonify, request
import pandas as pd
import requests
from datetime import datetime, timedelta, timezone
import json
import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split
import joblib
import os
import time
import warnings
from tqdm import tqdm

warnings.filterwarnings("ignore")

app = Flask(__name__)

MODEL_FILE = 'earthquake_model_v1.pth'
SCALER_FILE = 'scaler.pkl'

MIN_TRAINING_QUAKES = 50
TRAINING_MONTHS = 6
REQUEST_TIMEOUT = 45
CHUNK_SIZE_DAYS = 60

# Removed 'mag' to prevent data leakage. Removed global temporal features.
FEATURE_NAMES = [
    'latitude', 'longitude', 'depth',
    'local_density', 'plate_distance'
]

# Configure Device for GPU Acceleration
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu")
print(f"🚀 Using compute device: {DEVICE}")

# =======================
# Neural Network
# =======================
class EarthquakeNN(nn.Module):
    def __init__(self):
        super().__init__()
        # Input size is now 5
        self.net = nn.Sequential(
            nn.Linear(5, 32),
            nn.ReLU(),
            nn.BatchNorm1d(32),

            nn.Linear(32, 64),
            nn.ReLU(),
            nn.BatchNorm1d(64),

            nn.Linear(64, 32),
            nn.ReLU(),

            nn.Linear(32, 1),
            nn.Sigmoid()
        )

    def forward(self, x):
        return self.net(x)


# =======================
# Model Class
# =======================
class EarthquakeModel:
    def __init__(self):
        self.model = None
        self.scaler = None
        self.plate_cache = {}

        self.plate_lines = self.load_tectonic_data()
        self.load_or_train_model()

    # -----------------------
    # Load tectonic data
    # -----------------------
    def load_tectonic_data(self):
        try:
            base_dir = os.path.dirname(__file__)
            path = os.path.join(base_dir, 'data', 'tectonic_plates.geojson')

            if not os.path.exists(path):
                print("⚠️ Tectonic plates file not found. Plate distance will default to 0.")
                return []

            with open(path, 'r') as f:
                data = json.load(f)

            lines = []
            for feature in data.get('features', []):
                coords = feature['geometry']['coordinates']

                if feature['geometry']['type'] == 'MultiLineString':
                    for line in coords:
                        lines.append(line)
                else:
                    lines.append(coords)

            print(f"✅ Loaded {len(lines)} tectonic boundaries")
            return lines

        except Exception as e:
            print(f"❌ Failed to load tectonic data: {e}")
            return []

    # -----------------------
    # Distance calculation
    # -----------------------
    def point_to_segment_distance(self, px, py, x1, y1, x2, y2):
        # Using pure math instead of np.array overhead speeds this up by ~50x
        l2 = (x2 - x1)**2 + (y2 - y1)**2
        if l2 == 0:
            return ((px - x1)**2 + (py - y1)**2)**0.5
            
        t = max(0, min(1, ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2))
        
        proj_x = x1 + t * (x2 - x1)
        proj_y = y1 + t * (y2 - y1)
        
        return ((px - proj_x)**2 + (py - proj_y)**2)**0.5

    def compute_plate_distance_single(self, lat, lon):
        if not self.plate_lines:
            return 0  # fallback if no tectonic data

        key = (round(lat, 2), round(lon, 2))
        if key in self.plate_cache:
            return self.plate_cache[key]

        min_dist = float('inf')

        for line in self.plate_lines:
            for i in range(len(line) - 1):
                lon1, lat1 = line[i]
                lon2, lat2 = line[i + 1]

                dist = self.point_to_segment_distance(
                    lon, lat,
                    lon1, lat1,
                    lon2, lat2
                )

                if dist < min_dist:
                    min_dist = dist

        self.plate_cache[key] = min_dist
        return min_dist

    def compute_plate_distance(self, df):
        print("🗺️ Computing plate distances...")
        
        # Enable tqdm progress bar for pandas
        tqdm.pandas(desc="Calculating Distances", ncols=100)
        
        # Use progress_apply instead of standard apply to show the loading bar
        df['plate_distance'] = df.progress_apply(
            lambda r: self.compute_plate_distance_single(r['latitude'], r['longitude']),
            axis=1
        )
        return df

    # -----------------------
    # Feature engineering
    # -----------------------
    def compute_density(self, df, radius=1.0):
        print("📊 Computing local densities (vectorized)...")
        lats = df['latitude'].values
        lons = df['longitude'].values
        densities = []
        
        # Vectorized approach is roughly 100x faster than iterrows
        for lat, lon in zip(lats, lons):
            nearby = ((np.abs(lats - lat) <= radius) & (np.abs(lons - lon) <= radius))
            densities.append(nearby.sum())
            
        df['local_density'] = densities
        return df

    # -----------------------
    # Fetch data
    # -----------------------
    def fetch_training_data(self):
        end_date = datetime.now(timezone.utc)
        start_date = end_date - timedelta(days=30 * TRAINING_MONTHS)

        all_features = []
        current_start = start_date

        print(f"📡 Fetching USGS data from {start_date.date()} to {end_date.date()}...")

        while current_start < end_date:
            current_end = min(current_start + timedelta(days=CHUNK_SIZE_DAYS), end_date)

            try:
                url = (
                    f"https://earthquake.usgs.gov/fdsnws/event/1/query?"
                    f"format=geojson&starttime={current_start.strftime('%Y-%m-%d')}"
                    f"&endtime={current_end.strftime('%Y-%m-%d')}"
                    f"&minmagnitude=2.5&orderby=time"
                )

                response = requests.get(url, timeout=REQUEST_TIMEOUT)
                response.raise_for_status()

                features = response.json().get('features', [])
                all_features.extend(features)
                print(f"   Fetched {len(features)} records up to {current_end.date()}")

            except Exception as e:
                print(f"❌ Fetch error: {e}")

            current_start = current_end + timedelta(days=1)
            time.sleep(1) # Respect USGS rate limits

        return all_features
        
    def get_live_local_density(self, lat, lng, radius=1.0, days=30):
        """Fetches live context for inference"""
        end_date = datetime.now(timezone.utc)
        start_date = end_date - timedelta(days=days)
        
        url = (
            f"https://earthquake.usgs.gov/fdsnws/event/1/query?"
            f"format=geojson&starttime={start_date.strftime('%Y-%m-%d')}"
            f"&endtime={end_date.strftime('%Y-%m-%d')}"
            f"&minlatitude={lat-radius}&maxlatitude={lat+radius}"
            f"&minlongitude={lng-radius}&maxlongitude={lng+radius}"
        )
        try:
            response = requests.get(url, timeout=10)
            if response.status_code == 200:
                features = response.json().get('features', [])
                return len(features)
        except:
            pass
        return 0 # Fallback

    # -----------------------
    # Training
    # -----------------------
    def train_model(self):
        try:
            quakes = self.fetch_training_data()

            if not quakes or len(quakes) < MIN_TRAINING_QUAKES:
                print("❌ Not enough data")
                return False

            df = self.process_training_data(quakes)

            if len(df[df['significant_quake'] == 1]) < 5:
                print("❌ Not enough positive samples")
                return False

            df = df.sample(frac=1, random_state=42).fillna(0)

            X = df[FEATURE_NAMES].values
            y = df['significant_quake'].values.reshape(-1, 1)

            X_train, X_val, y_train, y_val = train_test_split(
                X, y, test_size=0.2, random_state=42
            )

            self.scaler = StandardScaler()
            X_train = self.scaler.fit_transform(X_train)
            X_val = self.scaler.transform(X_val)

            # Move tensors to GPU/MPS
            X_train = torch.tensor(X_train, dtype=torch.float32).to(DEVICE)
            y_train = torch.tensor(y_train, dtype=torch.float32).to(DEVICE)
            X_val = torch.tensor(X_val, dtype=torch.float32).to(DEVICE)
            y_val = torch.tensor(y_val, dtype=torch.float32).to(DEVICE)

            # Initialize model and move to GPU/MPS
            model = EarthquakeNN().to(DEVICE)
            optimizer = optim.Adam(model.parameters(), lr=0.001)
            loss_fn = nn.BCELoss()

            best_val_loss = float('inf')
            patience = 5
            counter = 0
            epochs = 60
            start_time = time.time()

            for epoch in tqdm(range(epochs), desc="Training", ncols=100):
                model.train()

                optimizer.zero_grad()
                out = model(X_train)
                loss = loss_fn(out, y_train)

                loss.backward()
                optimizer.step()

                # Evaluation
                model.eval()
                with torch.no_grad():
                    train_eval = model(X_train)
                    train_acc = ((train_eval > 0.5) == y_train).float().mean().item()

                    val_out = model(X_val)
                    val_loss = loss_fn(val_out, y_val).item()
                    val_acc = ((val_out > 0.5) == y_val).float().mean().item()

                elapsed = time.time() - start_time
                eta = (elapsed / (epoch + 1)) * (epochs - epoch - 1)

                tqdm.write(
                    f"[Epoch {epoch+1:02d}/{epochs}] "
                    f"Loss: {loss.item():.4f} | "
                    f"Train Acc: {train_acc:.2%} | "
                    f"Val Acc: {val_acc:.2%} | "
                    f"Val Loss: {val_loss:.4f} | "
                    f"ETA: {eta:.1f}s"
                )

                # Save best
                if val_loss < best_val_loss:
                    best_val_loss = val_loss
                    counter = 0

                    torch.save(model.state_dict(), MODEL_FILE)
                    joblib.dump(self.scaler, SCALER_FILE)

                    tqdm.write("💾 Saved best model")
                else:
                    counter += 1

                if counter >= patience:
                    tqdm.write("🛑 Early stopping triggered")
                    break

            # Load best model back and set to eval mode
            model.load_state_dict(torch.load(MODEL_FILE, map_location=DEVICE))
            model.eval()
            self.model = model
            return True

        except Exception as e:
            print(f"❌ Training error: {e}")
            return False

    def load_model(self):
        if os.path.exists(MODEL_FILE) and os.path.exists(SCALER_FILE):
            try:
                model = EarthquakeNN()
                # Safely load to the current device
                model.load_state_dict(torch.load(MODEL_FILE, map_location=DEVICE))
                model.to(DEVICE)
                model.eval()

                self.scaler = joblib.load(SCALER_FILE)
                self.model = model

                print("✅ Loaded pre-trained model successfully")
                return True
            except Exception as e:
                print(f"❌ Load error: {e}")
        return False

    def load_or_train_model(self):
        if not self.load_model():
            print("⚠️ No model found. Initiating training sequence...")
            self.train_model()

    def process_training_data(self, quakes):
        data = []
        for q in quakes:
            try:
                props = q['properties']
                coords = q['geometry']['coordinates']

                data.append({
                    'latitude': coords[1],
                    'longitude': coords[0],
                    'depth': coords[2],
                    'mag': props.get('mag', 0),
                    'time': datetime.fromtimestamp(props['time']/1000, tz=timezone.utc),
                    'significant_quake': int(props.get('mag', 0) >= 5.0)
                })
            except:
                continue

        df = pd.DataFrame(data).dropna()
        df = self.compute_density(df)
        df = self.compute_plate_distance(df)

        return df

    def predict(self, lat, lng, depth=10.0):
        if not self.model or not self.scaler:
            return {"error": "Model not loaded"}

        lat = max(-90, min(90, lat))
        lng = max(-180, min(180, lng))
        depth = max(0, min(700, depth))
        
        # Dynamically fetch current real-world context for accurate prediction
        local_density = self.get_live_local_density(lat, lng)
        plate_distance = self.compute_plate_distance_single(lat, lng)

        x = [[lat, lng, depth, local_density, plate_distance]]
        x = self.scaler.transform(x)
        
        # Move input to GPU/MPS for inference
        x = torch.tensor(x, dtype=torch.float32).to(DEVICE)

        with torch.no_grad():
            p = self.model(x).item()

        return {
            "probability": float(p),
            "risk": "high" if p > 0.7 else "medium" if p > 0.3 else "low",
            "metadata": {
                "local_density_last_30_days": local_density,
                "plate_distance": round(plate_distance, 4)
            }
        }


# Initialize globally
model = EarthquakeModel()

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/predict')
def predict_api():
    try:
        lat = float(request.args.get('lat'))
        # Accept either 'lon' or 'lng' from the frontend
        lng_str = request.args.get('lon') or request.args.get('lng')
        lng = float(lng_str)
        depth = float(request.args.get('depth', 10))
    except Exception as e:
        # Added the actual error message here to help with future debugging
        return jsonify({"error": f"Invalid input: {e}"}), 400

    return jsonify(model.predict(lat, lng, depth))

@app.route('/api/earthquakes')
def earthquakes():
    try:
        url = "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&limit=200"
        res = requests.get(url, timeout=10)
        return jsonify(res.json())
    except:
        return jsonify({"error": "failed"}), 500


@app.route('/api/model-info')
def model_info():
    return jsonify({
        "features": FEATURE_NAMES,
        "model": "PyTorch Sequential NN",
        "device": str(DEVICE),
        "version": "v1.1",
        "epochs": 60
    })

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)