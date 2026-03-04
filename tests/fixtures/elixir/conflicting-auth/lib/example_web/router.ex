defmodule ExampleWeb.Router do
  use Phoenix.Router

  pipeline :browser do
    plug :accepts, ["html"]
    plug :fetch_session
  end

  scope "/", ExampleWeb do
    pipe_through :browser

    get "/", PageController, :index
    get "/api/health", PageController, :health
  end

  scope "/auth", ExampleWeb do
    pipe_through :browser

    get "/:provider", AuthController, :request
    get "/:provider/callback", AuthController, :callback
    post "/:provider/callback", AuthController, :callback
    post "/logout", AuthController, :logout
  end
end
