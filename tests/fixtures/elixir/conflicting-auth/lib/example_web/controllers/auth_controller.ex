defmodule ExampleWeb.AuthController do
  use Phoenix.Controller, formats: [:html]
  plug Ueberauth

  def request(conn, _params) do
    html(conn, """
    <h1>Sign In</h1>
    <form method="POST" action="/auth/identity/callback">
      <input type="email" name="email" placeholder="Email">
      <input type="password" name="password" placeholder="Password">
      <button type="submit">Sign in</button>
    </form>
    """)
  end

  def callback(%{assigns: %{ueberauth_auth: auth}} = conn, _params) do
    conn
    |> put_session(:user, %{email: auth.info.email})
    |> redirect(to: "/")
  end

  def callback(%{assigns: %{ueberauth_failure: _failure}} = conn, _params) do
    conn
    |> put_status(401)
    |> text("Authentication failed")
  end

  def logout(conn, _params) do
    conn
    |> clear_session()
    |> redirect(to: "/")
  end
end
