require "sinatra"
require "omniauth"
require "omniauth-auth0"

enable :sessions
set :session_secret, ENV.fetch("SESSION_SECRET", "super-secret-key")
set :port, 3000

use OmniAuth::Builder do
  provider :auth0,
    ENV["AUTH0_CLIENT_ID"],
    ENV["AUTH0_CLIENT_SECRET"],
    ENV["AUTH0_DOMAIN"]
end

get "/" do
  if session[:user]
    "<!doctype html><html><body>" \
    "<h1>Welcome, #{session[:user]["info"]["name"]}</h1>" \
    "<p><a href=\"/logout\">Sign out</a></p>" \
    "</body></html>"
  else
    send_file "index.html"
  end
end

get "/api/health" do
  content_type :json
  '{"status":"ok","version":"1.0.0"}'
end

get "/auth/auth0/callback" do
  auth = request.env["omniauth.auth"]
  session[:user] = auth
  redirect "/"
end

get "/auth/failure" do
  "Authentication failed: #{params[:message]}"
end

get "/logout" do
  session.clear
  redirect "/"
end
