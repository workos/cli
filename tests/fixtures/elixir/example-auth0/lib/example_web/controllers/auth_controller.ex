defmodule ExampleWeb.AuthController do
  use ExampleWeb, :controller
  plug Ueberauth

  def request(conn, _params) do
    # Ueberauth handles the redirect to Auth0 automatically
    conn
  end

  def callback(%{assigns: %{ueberauth_auth: auth}} = conn, _params) do
    user = %{
      name: auth.info.name,
      email: auth.info.email
    }

    conn
    |> put_session(:user, user)
    |> redirect(to: "/")
  end

  def callback(%{assigns: %{ueberauth_failure: _failure}} = conn, _params) do
    conn
    |> put_status(401)
    |> text("Authentication failed")
  end

  def sign_out(conn, _params) do
    conn
    |> clear_session()
    |> redirect(to: "/")
  end
end
