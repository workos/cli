require "sinatra"
require "dotenv/load"
require "workos"

set :port, 3000

WorkOS.configure do |config|
  config.api_key = ENV["WORKOS_API_KEY"]
  config.client_id = ENV["WORKOS_CLIENT_ID"]
end

get "/" do
  send_file "index.html"
end

get "/login" do
  # TODO: implement login redirect
  status 501
  "Not implemented"
end

# TODO: implement /callback route

get "/api/health" do
  content_type :json
  { status: "ok", version: "1.0.0" }.to_json
end
