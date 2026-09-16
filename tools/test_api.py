import json
import urllib.request

req = urllib.request.Request(
    "http://localhost:8081/api/v1/auth/login",
    data=json.dumps({"username": "admin", "password": "admin123"}).encode("utf-8"),
    headers={"Content-Type": "application/json"}
)
try:
    with urllib.request.urlopen(req) as resp:
        body = resp.read().decode("utf-8")
        login_data = json.loads(body)
        print("Login response:", login_data)
        token = login_data.get("token") or login_data.get("accessToken") or login_data.get("data", {}).get("token")
except Exception as e:
    print("Login error:", e)
    token = None

if token:
    req2 = urllib.request.Request(
        "http://localhost:8081/api/v1/programming/projects/aeb965ac-9d66-4d9b-84ba-8c9995d0d189",
        headers={"Authorization": f"Bearer {token}"}
    )
    try:
        with urllib.request.urlopen(req2) as resp:
            body2 = resp.read().decode("utf-8")
            proj_data = json.loads(body2)
            print(json.dumps(proj_data, indent=2))
    except Exception as e:
        print("Project get error:", e)
