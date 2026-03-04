import os
from flask import Flask, send_file
from dotenv import load_dotenv
from workos import WorkOSClient

load_dotenv()

app = Flask(__name__)

workos_client = WorkOSClient(
    api_key=os.environ.get("WORKOS_API_KEY", ""),
    client_id=os.environ.get("WORKOS_CLIENT_ID", ""),
)

@app.route("/")
def index():
    return send_file("index.html")

# TODO: implement login route
# @app.route("/login")
# def login():
#     authorization_url = workos_client.user_management.get_authorization_url(
#         provider="authkit",
#         redirect_uri=os.environ.get("WORKOS_REDIRECT_URI", ""),
#     )
#     return redirect(authorization_url)

# TODO: implement callback route

@app.route("/api/health")
def health():
    return {"status": "ok", "version": "1.0.0"}

if __name__ == "__main__":
    app.run(debug=True, port=3000)
