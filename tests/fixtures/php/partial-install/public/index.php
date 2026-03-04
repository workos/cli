<?php

// Simple health check and home page
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

if ($path === '/api/health') {
    header('Content-Type: application/json');
    echo json_encode(['status' => 'ok', 'version' => '1.0.0']);
    exit;
}
?>
<!doctype html>
<html lang="en">
  <head><title>AuthKit example</title></head>
  <body>
    <h1>AuthKit example</h1>
    <p><a href="/login.php">Sign in</a></p>
    <p><a href="/logout.php">Sign out</a></p>
  </body>
</html>
