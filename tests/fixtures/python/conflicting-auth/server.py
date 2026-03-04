import os
from flask import Flask, send_file, request, redirect, url_for, session
from flask_login import LoginManager, UserMixin, login_user, logout_user, login_required, current_user
from flask_bcrypt import Bcrypt

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "super-secret-key")

bcrypt = Bcrypt(app)
login_manager = LoginManager(app)
login_manager.login_view = "login"

# Hardcoded user for demo
class User(UserMixin):
    def __init__(self, id, username, password_hash):
        self.id = id
        self.username = username
        self.password_hash = password_hash

users_db = {
    "1": User("1", "admin", bcrypt.generate_password_hash("password123").decode("utf-8"))
}

@login_manager.user_loader
def load_user(user_id):
    return users_db.get(user_id)

@app.route("/")
def index():
    return send_file("index.html")

@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        username = request.form.get("username")
        password = request.form.get("password")
        for user in users_db.values():
            if user.username == username and bcrypt.check_password_hash(user.password_hash, password):
                login_user(user)
                return redirect(url_for("dashboard"))
        return "Invalid credentials", 401
    return '<form method="post"><input name="username"><input name="password" type="password"><button>Login</button></form>'

@app.route("/logout")
def logout():
    logout_user()
    return redirect(url_for("index"))

@app.route("/dashboard")
@login_required
def dashboard():
    return f"<h1>Dashboard</h1><p>Welcome, {current_user.username}!</p><a href='/logout'>Logout</a>"

@app.route("/api/health")
def health():
    return {"status": "ok", "version": "1.0.0"}

if __name__ == "__main__":
    app.run(debug=True, port=3000)
