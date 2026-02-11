# 🌍 Earthquake Predictor — Machine Learning Powered Seismic Risk Dashboard

A modern, data-driven earthquake prediction and visualization platform that analyzes historical seismic activity and predicts potential earthquake hotspots using Machine Learning.

---

## 🚀 Project Overview

Earthquakes are unpredictable, but **risk is not random**.
This project combines **data science, machine learning, and interactive visualization** to identify seismic patterns and forecast potential earthquake hotspots.

The system provides:

* 📊 Real-time visualization of earthquakes
* 🤖 ML-based hotspot prediction
* 🗺️ Interactive geospatial dashboard
* 📈 Trend & risk analysis tools

This project is designed as a **full-stack data + ML application**.

---

## ✨ Features

### 🌐 Interactive Earthquake Dashboard

* Live earthquake data visualization on map
* Magnitude, depth, and location filters
* Historical earthquake timeline analysis
* Region-based seismic activity tracking

### 🤖 Machine Learning Prediction

* Predicts **future earthquake hotspots**
* Uses historical seismic dataset patterns
* Identifies high-risk geographic clusters
* Visual hotspot overlay on map

### 📊 Data Insights

* Magnitude distribution graphs
* Depth vs frequency analysis
* Regional activity comparison
* Statistical trend visualization

---

## 🧠 Machine Learning Approach

The prediction model learns from historical earthquake data to detect patterns in:

| Feature              | Description         |
| -------------------- | ------------------- |
| Latitude & Longitude | Earthquake location |
| Magnitude            | Earthquake strength |
| Depth                | Underground depth   |
| Time patterns        | Temporal clustering |
| Seismic frequency    | Recurring activity  |

### Algorithms Used

* Clustering (K-Means / DBSCAN)
* Regression models for risk scoring
* Feature scaling & preprocessing
* Model evaluation & tuning

**Output:** Probability-based hotspot risk map.

---

## 🏗️ Tech Stack

### Frontend

* HTML / CSS / JavaScript
* Interactive Maps (Leaflet / Mapbox)
* Chart.js for analytics

### Backend

* Python (Flask)
* REST APIs for data delivery

### Machine Learning

* Python
* Pandas & NumPy
* Scikit-learn
* Data preprocessing & model training

### Data Source

* USGS Earthquake Dataset (Historical seismic data)

---

## 📂 Project Structure

```
earthquake-predictor/
│
├── app.py                # Flask backend
├── model/
│   ├── train_model.py    # ML training pipeline
│   ├── predictor.pkl     # Saved trained model
│
├── static/
│   ├── css/
│   ├── js/
│   ├── charts/
│
├── templates/
│   └── index.html        # Main dashboard
│
└── data/
    └── earthquakes.csv   # Dataset
```

---

## ⚙️ Installation & Setup

### 1️⃣ Clone Repository

```bash
git clone https://github.com/yourusername/earthquake-predictor.git
cd earthquake-predictor
```

### 2️⃣ Create Virtual Environment

```bash
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
```

### 3️⃣ Install Dependencies

```bash
pip install -r requirements.txt
```

### 4️⃣ Train the Model

```bash
python model/train_model.py
```

### 5️⃣ Run the
