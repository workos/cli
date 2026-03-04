import Config

config :example, ExampleWeb.Endpoint,
  url: [host: "localhost"],
  http: [port: 3000],
  secret_key_base: "placeholder_secret_key_base_for_fixture"

config :ueberauth, Ueberauth,
  providers: [
    identity: {Ueberauth.Strategy.Identity, [
      callback_methods: ["POST"],
      uid_field: :email
    ]}
  ]
