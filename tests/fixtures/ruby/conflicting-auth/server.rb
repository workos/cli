require "sinatra"
require "dotenv/load"
require "warden"

set :port, 3000
enable :sessions
set :session_secret, ENV.fetch("SESSION_SECRET", "super-secret-key")

# Hardcoded user for demo
USERS = { "admin" => "password123" }

Warden::Strategies.add(:password) do
  def valid?
    params["username"] && params["password"]
  end

  def authenticate!
    user = params["username"]
    if USERS[user] == params["password"]
      success!(user)
    else
      fail!("Invalid credentials")
    end
  end
end

use Warden::Manager do |manager|
  manager.default_strategies :password
  manager.failure_app = ->(env) { [401, {}, ["Unauthorized"]] }
end

get "/" do
  send_file "index.html"
end

post "/login" do
  env["warden"].authenticate!
  redirect "/dashboard"
end

get "/logout" do
  env["warden"].logout
  redirect "/"
end

get "/dashboard" do
  env["warden"].authenticate!
  user = env["warden"].user
  "<h1>Dashboard</h1><p>Welcome, #{user}!</p><a href='/logout'>Logout</a>"
end

get "/api/health" do
  content_type :json
  { status: "ok", version: "1.0.0" }.to_json
end
