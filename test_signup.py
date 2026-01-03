import requests
import uuid

base_url = "http://localhost:8080/api"

def test_signup():
    email = f"test_{uuid.uuid4()}@example.com"
    password = "password123"
    name = "Test User"
    
    print(f"Attempting to register user: {email}")
    
    try:
        response = requests.post(f"{base_url}/register", json={
            "email": email,
            "password": password,
            "name": name
        })
        
        if response.status_code == 200:
            print("Signup successful!")
            print(f"Response: {response.json()}")
            return True
        else:
            print(f"Signup failed. Status: {response.status_code}")
            print(f"Error: {response.text}")
            return False
    except Exception as e:
        print(f"Request failed: {e}")
        return False

if __name__ == "__main__":
    test_signup()
