npx expo start -c --tunnel

venv\Scripts\Activate
python -m uvicorn server:app --host 0.0.0.0 --port 8000


npx expo start --dev-client

$env:Path += ";C:\Users\HP\AppData\Local\Android\Sdk\platform-tools"
adb devices


USB :
bridge connection: 
adb reverse tcp:8081 tcp:8081
run on terminal :
npx expo start --dev-client
write this in phone :
http://localhost:8081