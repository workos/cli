var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

app.MapGet("/", () => Results.Content(
    System.IO.File.ReadAllText("index.html"), "text/html"));

app.Run("http://localhost:3000");
