#!/usr/bin/env python3

import requests
import json
import sys
from datetime import datetime

# Test configuration
BACKEND_URL = "https://rapid-scan-app.preview.emergentagent.com/api"

def log_test(test_name, status, details=""):
    """Log test results"""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    status_symbol = "✅" if status == "PASS" else "❌" if status == "FAIL" else "⚠️"
    print(f"[{timestamp}] {status_symbol} {test_name}")
    if details:
        print(f"    Details: {details}")
    print()

def test_health_endpoint():
    """Test GET /api/health endpoint"""
    try:
        response = requests.get(f"{BACKEND_URL}/health", timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            if "status" in data and data["status"] == "healthy":
                log_test("Health Check", "PASS", f"Response: {data}")
                return True
            else:
                log_test("Health Check", "FAIL", f"Invalid response format: {data}")
                return False
        else:
            log_test("Health Check", "FAIL", f"HTTP {response.status_code}: {response.text}")
            return False
            
    except requests.exceptions.RequestException as e:
        log_test("Health Check", "FAIL", f"Request failed: {str(e)}")
        return False

def test_batches_endpoint():
    """Test GET /api/batches endpoint - should return mock batches"""
    try:
        response = requests.get(f"{BACKEND_URL}/batches", timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            if "batches" in data and len(data["batches"]) > 0:
                batches = data["batches"]
                sample_batch = batches[0]
                
                # Verify batch structure
                required_fields = ["batch_id", "name", "student_count"]
                if all(field in sample_batch for field in required_fields):
                    log_test("Batches Endpoint", "PASS", f"Found {len(batches)} batches. Sample: {sample_batch}")
                    return True
                else:
                    log_test("Batches Endpoint", "FAIL", f"Invalid batch structure: {sample_batch}")
                    return False
            else:
                log_test("Batches Endpoint", "FAIL", f"No batches found in response: {data}")
                return False
        else:
            log_test("Batches Endpoint", "FAIL", f"HTTP {response.status_code}: {response.text}")
            return False
            
    except requests.exceptions.RequestException as e:
        log_test("Batches Endpoint", "FAIL", f"Request failed: {str(e)}")
        return False

def test_scan_session_create():
    """Test POST /api/scan-sessions/create endpoint"""
    try:
        # Test data as specified in the request
        test_payload = {
            "session_name": "Test Session",
            "batch_id": "batch_001",
            "settings": {}
        }
        
        response = requests.post(
            f"{BACKEND_URL}/scan-sessions/create",
            json=test_payload,
            headers={"Content-Type": "application/json"},
            timeout=10
        )
        
        if response.status_code == 200:
            data = response.json()
            if "session_id" in data and data["session_id"].startswith("scan_"):
                session_id = data["session_id"]
                log_test("Scan Session Create", "PASS", f"Created session: {session_id}")
                return session_id
            else:
                log_test("Scan Session Create", "FAIL", f"Invalid response format: {data}")
                return None
        else:
            log_test("Scan Session Create", "FAIL", f"HTTP {response.status_code}: {response.text}")
            return None
            
    except requests.exceptions.RequestException as e:
        log_test("Scan Session Create", "FAIL", f"Request failed: {str(e)}")
        return None

def test_session_status(session_id):
    """Test GET /api/scan-sessions/{session_id}/status endpoint"""
    if not session_id:
        log_test("Session Status", "SKIP", "No session ID available")
        return False
        
    try:
        response = requests.get(f"{BACKEND_URL}/scan-sessions/{session_id}/status", timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            if "status" in data:
                log_test("Session Status", "PASS", f"Status: {data}")
                return True
            else:
                log_test("Session Status", "FAIL", f"Invalid response format: {data}")
                return False
        else:
            log_test("Session Status", "FAIL", f"HTTP {response.status_code}: {response.text}")
            return False
            
    except requests.exceptions.RequestException as e:
        log_test("Session Status", "FAIL", f"Request failed: {str(e)}")
        return False

def main():
    """Run all backend API tests"""
    print("🧪 GradeSense Scanner Backend API Tests")
    print("=" * 50)
    print(f"Backend URL: {BACKEND_URL}")
    print()
    
    # Track test results
    results = []
    
    # Test 1: Health endpoint
    results.append(("Health Check", test_health_endpoint()))
    
    # Test 2: Batches endpoint
    results.append(("Batches Endpoint", test_batches_endpoint()))
    
    # Test 3: Create scan session
    session_id = test_scan_session_create()
    results.append(("Scan Session Create", session_id is not None))
    
    # Test 4: Session status (depends on successful session creation)
    results.append(("Session Status", test_session_status(session_id)))
    
    # Summary
    print("=" * 50)
    print("📊 Test Summary")
    print("=" * 50)
    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for test_name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{status} {test_name}")
    
    print()
    print(f"Total: {passed}/{total} tests passed")
    
    if passed == total:
        print("🎉 All tests passed!")
        return 0
    else:
        print("❌ Some tests failed")
        return 1

if __name__ == "__main__":
    exit_code = main()
    sys.exit(exit_code)