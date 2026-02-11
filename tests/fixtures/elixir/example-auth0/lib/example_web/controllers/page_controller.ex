defmodule ExampleWeb.PageController do
  use Phoenix.Controller, formats: [:html]

  def health(conn, _params) do
    json(conn, %{status: "ok", version: "1.0.0"})
  end

  def index(conn, _params) do
    html(conn, """
    <!doctype html>
    <html lang="en">
      <head><title>AuthKit example</title></head>
      <body>
        <h1>AuthKit example</h1>
        <p><a href="/login">Sign in</a></p>
        <p><a href="/logout">Sign out</a></p>
      </body>
    </html>
    """)
  end
end
