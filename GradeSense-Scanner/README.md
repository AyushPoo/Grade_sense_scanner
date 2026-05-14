# GradeSense Scanner

High-throughput document scanning and processing pipeline for GradeSense.

## Prerequisites

### Backend
- **Python 3.10+**
- **MongoDB**: Access to a MongoDB cluster (configured in `.env`)
- **Environment Variables**:
  - `MONGO_URL`: Connection string
  - `DB_NAME`: Database name
  - `PORT`: Server port (default 8000)

### Frontend
- **Node.js 18+**
- **Expo CLI**: `npm install -g expo-cli`
- **Android ADB**: Installed and accessible in PATH
- **Environment Variables**:
  - `EXPO_PUBLIC_BACKEND_URL`: URL of the running backend (use local IP for physical device testing)

---

## Development Workflow

### 1. Connect Device
Ensure your Android phone is connected via USB and USB Debugging is enabled.
```bash
adb devices
```
*Wait for your device to show as `device`.*

### 2. Run Backend
```bash
cd backend
# Recommended: Create and activate virtual environment
python -m venv venv
.\venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Start server
python -m uvicorn server:app --host 0.0.0.0 --port 8000
```

### 3. Setup Frontend
```bash
cd frontend
# Install dependencies
npm install

# Install development build on phone (First time or native change)
npx expo run:android

# Start development server
npx expo start --dev-client --clear
```

---

## Key Features
- **Deterministic Identity**: Strict React reconciliation using `ui_id` for zero-flicker UI.
- **Native Document Scanner**: Integration with high-performance OpenCV-backed scanning.
- **Persistence**: Hybrid Zustand + AsyncStorage with aggressive Base64 optimization.
- **Real-time Sync**: Automatic background metadata synchronization with the backend.
