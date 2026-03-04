defmodule ExampleWeb.Router do
  use Phoenix.Router

  pipeline :browser do
    plug :accepts, ["html"]
  end

  scope "/", ExampleWeb do
    pipe_through :browser

    get "/", PageController, :index
  end
end
