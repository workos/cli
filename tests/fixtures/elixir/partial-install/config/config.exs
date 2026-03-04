import Config

config :example, ExampleWeb.Endpoint,
  url: [host: "localhost"],
  http: [port: 3000],
  secret_key_base: "placeholder_secret_key_base_for_fixture"

config :workos,
  api_key: System.get_env("WORKOS_API_KEY"),
  client_id: System.get_env("WORKOS_CLIENT_ID")
