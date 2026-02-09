require "sinatra"

set :port, 3000

get "/" do
  send_file "index.html"
end
