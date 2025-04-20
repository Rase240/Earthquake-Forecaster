from flask import Flask, render_template, jsonify, request
import pandas as pd
import requests
from datetime import datetime, timedelta, timezone
from sklearn.ensemble import RandomForestClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
import joblib
import os
import time
from functools import lru_cache
import warnings

warnings.filterwarnings("ignore", category=UserWarning)
warnings.filterwarnings("ignore", category=FutureWarning)

app = Flask(__name__)

MODEL_FILE = 'earthquake_model.pkl'
MIN_TRAINING_QUAKES = 50
TRAINING_MONTHS = 6
REQUEST_TIMEOUT = 45
CHUNK_SIZE_DAYS = 60
FEATURE_NAMES = ['latitude', 'longitude', 'depth', 'mag']

class EarthquakeModel:
    def __init__(self):
        self.model = None
        self.last_trained = None
        self.load_or_train_model()

    def load_or_train_model(self):
        if self.load_model():
            print("✅ Loaded existing model.")
        else:
            print("⚠️ No trained model found. Attempting to train...")
            if self.train_model():
                print("✅ Model trained successfully.")
            else:
                print("❌ Model training failed.")

    def load_model(self):
        if os.path.exists(MODEL_FILE):
            try:
                self.model = joblib.load(MODEL_FILE)
                self.last_trained = os.path.getmtime(MODEL_FILE)
                return True
            except Exception as e:
                print(f"× Error loading model: {e}")
        return False

    def train_model(self):
        print("⚙️ Training model...")
        try:
            quakes = self.fetch_training_data()
            if not quakes or len(quakes) < MIN_TRAINING_QUAKES:
                print("× Not enough training data.")
                return False

            df = self.process_training_data(quakes)
            if len(df[df['significant_quake'] == 1]) < 5:
                print("× Not enough significant quakes.")
                return False

            pipeline = Pipeline([
                ('scaler', StandardScaler()),
                ('classifier', RandomForestClassifier(
                    n_estimators=50,
                    max_depth=5,
                    class_weight='balanced',
                    random_state=42,
                    n_jobs=-1))
            ])

            pipeline.fit(df[FEATURE_NAMES], df['significant_quake'])
            joblib.dump(pipeline, MODEL_FILE)
            self.model = pipeline
            self.last_trained = time.time()
            return True

        except Exception as e:
            print(f"× Training failed: {e}")
            return False

    def fetch_training_data(self):
        end_date = datetime.now(timezone.utc)
        start_date = end_date - timedelta(days=30 * TRAINING_MONTHS)
        all_features = []

        current_start = start_date
        while current_start < end_date:
            current_end = min(current_start + timedelta(days=CHUNK_SIZE_DAYS), end_date)
            try:
                url = (f"https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson"
                       f"&starttime={current_start.strftime('%Y-%m-%d')}"
                       f"&endtime={current_end.strftime('%Y-%m-%d')}"
                       f"&minmagnitude=2.5&orderby=time")
                response = requests.get(url, timeout=REQUEST_TIMEOUT)
                response.raise_for_status()
                all_features.extend(response.json().get('features', []))
            except Exception as e:
                print(f"× Failed to fetch data for {current_start.date()} to {current_end.date()}: {e}")
            current_start = current_end + timedelta(days=1)
            time.sleep(1)

        return all_features

    def process_training_data(self, quakes):
        processed = []
        for q in quakes:
            try:
                props = q.get('properties', {})
                coords = q.get('geometry', {}).get('coordinates', [0, 0, 10])
                processed.append({
                    'latitude': max(-90, min(90, coords[1])),
                    'longitude': max(-180, min(180, coords[0])),
                    'depth': max(0, min(700, coords[2])),
                    'mag': max(0, min(10, props.get('mag', 0))),
                    'significant_quake': int(props.get('mag', 0) >= 5.0)
                })
            except Exception as e:
                print(f"! Skipping malformed quake: {e}")
        return pd.DataFrame(processed).dropna()

    def predict(self, lat, lng, depth=10.0, mag=4.0):
        if not self.model:
            return None
        try:
            input_df = pd.DataFrame([[lat, lng, depth, mag]], columns=FEATURE_NAMES)
            proba = self.model.predict_proba(input_df)[0, 1]
            return {
                'probability': float(proba),
                'risk': 'high' if proba > 0.7 else 'medium' if proba > 0.3 else 'low'
            }
        except Exception as e:
            print(f"× Prediction error: {e}")
            return None

    def predict_hotspots(self, grid_size=5):
        if not self.model:
            return None
        try:
            lats = range(-90, 90, grid_size)
            lngs = range(-180, 180, grid_size)
            hotspots = []
            for lat in lats:
                for lng in lngs:
                    prediction = self.predict(lat, lng)
                    if prediction and prediction['probability'] > 0.5:
                        hotspots.append({
                            'latitude': lat,
                            'longitude': lng,
                            'probability': prediction['probability'],
                            'risk': prediction['risk']
                        })
            return hotspots
        except Exception as e:
            print(f"× Hotspot prediction error: {e}")
            return None

model = EarthquakeModel()

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/earthquakes')
def get_earthquakes():
    try:
        days = min(90, max(1, int(request.args.get('days', 30))))
        min_mag = min(9, max(1, float(request.args.get('min_mag', 2.5))))

        end_date = datetime.now(timezone.utc)
        start_date = end_date - timedelta(days=days)

        url = (f"https://earthquake.usgs.gov/fdsnws/event/1/query?"
               f"format=geojson&starttime={start_date.strftime('%Y-%m-%d')}"
               f"&endtime={end_date.strftime('%Y-%m-%d')}"
               f"&minmagnitude={min_mag}")

        response = requests.get(url, timeout=REQUEST_TIMEOUT)
        response.raise_for_status()
        features = response.json().get('features', [])

        print(f"✅ USGS returned {len(features)} earthquakes")

        if model.model:
            for feature in features:
                try:
                    coords = feature.get('geometry', {}).get('coordinates', [0, 0, 10])
                    props = feature.get('properties', {})
                    prediction = model.predict(
                        lat=coords[1],
                        lng=coords[0],
                        depth=coords[2],
                        mag=props.get('mag', 4.0)
                    )
                    if prediction:
                        props['prediction'] = prediction['probability']
                        props['risk'] = prediction['risk']
                except Exception as e:
                    print(f"⚠️ Failed to predict for quake: {e}")

        return jsonify({
            'type': 'FeatureCollection',
            'features': features,
            'count': len(features),
            'status': 'success',
            'generated': datetime.now(timezone.utc).isoformat()
        })

    except Exception as e:
        print(f"❌ Backend error: {e}")
        return jsonify({
            'status': 'error',
            'error': str(e),
            'message': 'Failed to fetch earthquake data'
        }), 500

@app.route('/api/predict')
def predict():
    try:
        lat = float(request.args.get('lat'))
        lng = float(request.args.get('lon', request.args.get('lng')))
        depth = float(request.args.get('depth', 10.0))
        mag = float(request.args.get('mag', 4.0))

        prediction = model.predict(lat, lng, depth, mag)

        if not prediction and not model.model:
            print("⚠️ No model available, attempting to train...")
            if model.train_model():
                prediction = model.predict(lat, lng, depth, mag)

        if not prediction:
            raise Exception("Prediction unavailable")

        return jsonify({
            'status': 'success',
            'latitude': lat,
            'longitude': lng,
            'probability': prediction['probability'],
            'risk': prediction['risk'],
            'timestamp': datetime.now(timezone.utc).isoformat()
        })

    except Exception as e:
        return jsonify({
            'status': 'error',
            'error': str(e),
            'message': 'Prediction failed'
        }), 400

@app.route('/api/hotspots')
def get_hotspots():
    try:
        hotspots = model.predict_hotspots()
        if not hotspots:
            return jsonify({'status': 'error', 'message': 'Hotspot prediction unavailable'}), 503
        return jsonify({
            'status': 'success',
            'hotspots': hotspots,
            'count': len(hotspots),
            'generated': datetime.now(timezone.utc).isoformat()
        })
    except Exception as e:
        return jsonify({
            'status': 'error',
            'error': str(e),
            'message': 'Failed to generate hotspots'
        }), 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=True)
