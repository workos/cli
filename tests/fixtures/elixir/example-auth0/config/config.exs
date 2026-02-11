import Config

config :example, ExampleWeb.Endpoint,
  url: [host: "localhost"],
  http: [port: 3000],
  secret_key_base: "placeholder_secret_key_base_for_fixture"

config :ueberauth, Ueberauth,
  providers: [
    auth0: {Ueberauth.Strategy.Auth0, [
      domain: System.get_env("AUTH0_DOMAIN"),
      client_id: System.get_env("AUTH0_CLIENT_ID"),
      client_secret: System.get_env("AUTH0_CLIENT_SECRET")
    ]}
  ]
