import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix
import joblib

df = pd.read_csv("data/earthquake_data.csv")  


df['significant_quake'] = (df['mag'] >= 4.5).astype(int)

features = ['latitude', 'longitude', 'depth', 'mag']
X = df[features]
y = df['significant_quake']

X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

model = joblib.load("earthquake_model.pkl")  

y_pred = model.predict(X_test)

acc = accuracy_score(y_test, y_pred)
print(f"✅ Model Accuracy: {acc:.2%}\n")

print("📊 Classification Report:")
print(classification_report(y_test, y_pred))

print("🧾 Confusion Matrix:")
print(confusion_matrix(y_test, y_pred))
