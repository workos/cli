import os
from flask import Flask, redirect, session, url_for, send_file
from dotenv import load_dotenv
from authlib.integrations.flask_client import OAuth

load_dotenv()

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "super-secret-key")

oauth = OAuth(app)
auth0 = oauth.register(
    "auth0",
    client_id=os.environ.get("AUTH0_CLIENT_ID"),
    client_secret=os.environ.get("AUTH0_CLIENT_SECRET"),
    api_base_url=f'https://{os.environ.get("AUTH0_DOMAIN")}',
    access_token_url=f'https://{os.environ.get("AUTH0_DOMAIN")}/oauth/token',
    authorize_url=f'https://{os.environ.get("AUTH0_DOMAIN")}/authorize',
    client_kwargs={"scope": "openid profile email"},
)


@app.route("/")
def index():
    user = session.get("user")
    if user:
        return f"<h1>Welcome, {user['name']}</h1><p><a href='/logout'>Sign out</a></p>"
    return send_file("index.html")


@app.route("/login")
def login():
    return auth0.authorize_redirect(redirect_uri=url_for("callback", _external=True))


@app.route("/callback")
def callback():
    token = auth0.authorize_access_token()
    user_info = token.get("userinfo")
    if user_info is None:
        user_info = auth0.get("userinfo").json()
    session["user"] = user_info
    return redirect("/")


@app.route("/api/health")
def health():
    return {"status": "ok", "version": "1.0.0"}


@app.route("/logout")
def logout():
    session.clear()
    auth0_domain = os.environ.get("AUTH0_DOMAIN")
    client_id = os.environ.get("AUTH0_CLIENT_ID")
    return_to = url_for("index", _external=True)
    return redirect(
        f"https://{auth0_domain}/v2/logout?client_id={client_id}&returnTo={return_to}"
    )


if __name__ == "__main__":
    app.run(debug=True, port=3000)
