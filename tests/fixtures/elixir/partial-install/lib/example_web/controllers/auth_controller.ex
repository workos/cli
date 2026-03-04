defmodule ExampleWeb.AuthController do
  use Phoenix.Controller, formats: [:html]
  import Plug.Conn

  # TODO: implement sign_in to redirect to WorkOS authorization URL
  def sign_in(conn, _params) do
    conn
    |> put_status(501)
    |> text("Not implemented")
  end

  # TODO: implement callback to exchange code for user profile
  # TODO: implement sign_out to clear session
end
