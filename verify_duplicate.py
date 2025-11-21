import requests
import os

BASE_URL = "http://localhost:8000"
TEST_FILE_NAME = "test_duplicate.pdf"
TEST_FILE_CONTENT = b"%PDF-1.4\n%Test file for duplicate check"

def create_test_file():
    with open(TEST_FILE_NAME, "wb") as f:
        f.write(TEST_FILE_CONTENT)

import random
import string

def register_and_login():
    email = "zhongjiayou1202@gmail.com"
    password = "Zjy2022@00"
    
    print(f"Logging in as: {email}")
    
    # Login
    response = requests.post(f"{BASE_URL}/api/login", json={"email": email, "password": password})
    if response.status_code != 200:
        raise Exception(f"Login failed: {response.text}")
    
    return response.json()["token"]

def upload_file(filename, token):
    headers = {"Authorization": f"Bearer {token}"}
    with open(filename, "rb") as f:
        files = {"file": (filename, f, "application/pdf")}
        response = requests.post(f"{BASE_URL}/api/upload", files=files, headers=headers)
        return response

def test_duplicate_upload():
    print("Creating test file...")
    create_test_file()

    try:
        print("Authenticating...")
        token = register_and_login()
        print("Authenticated successfully.")

        # 1. First Upload
        print("\n1. Uploading file for the first time...")
        response1 = upload_file(TEST_FILE_NAME, token)
        print(f"Status Code: {response1.status_code}")
        print(f"Response: {response1.json()}")
        
        if response1.status_code != 200:
            print("❌ First upload failed!")
            return

        # 2. Second Upload (Duplicate)
        print("\n2. Uploading the same file again (expecting 409)...")
        response2 = upload_file(TEST_FILE_NAME, token)
        print(f"Status Code: {response2.status_code}")
        print(f"Response: {response2.json()}")

        if response2.status_code == 409:
            print("✅ Duplicate detection worked! (Got 409 Conflict)")
        else:
            print(f"❌ Duplicate detection failed! Expected 409, got {response2.status_code}")

    except Exception as e:
        print(f"❌ Error: {e}")
    finally:
        if os.path.exists(TEST_FILE_NAME):
            os.remove(TEST_FILE_NAME)

if __name__ == "__main__":
    test_duplicate_upload()
