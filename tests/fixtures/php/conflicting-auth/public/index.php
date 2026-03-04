<?php
session_start();

$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

// Health check
if ($path === '/api/health') {
    header('Content-Type: application/json');
    echo json_encode(['status' => 'ok', 'version' => '1.0.0']);
    exit;
}

// Hardcoded user for demo
$users = [
    ['id' => 1, 'username' => 'admin', 'password' => 'password123'],
];

// Login handler
if ($path === '/login' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $username = $_POST['username'] ?? '';
    $password = $_POST['password'] ?? '';

    foreach ($users as $user) {
        if ($user['username'] === $username && $user['password'] === $password) {
            $_SESSION['user'] = $user;
            header('Location: /dashboard');
            exit;
        }
    }
    header('Location: /?error=invalid');
    exit;
}

// Logout
if ($path === '/logout') {
    session_destroy();
    header('Location: /');
    exit;
}

// Dashboard (protected)
if ($path === '/dashboard') {
    if (!isset($_SESSION['user'])) {
        header('Location: /');
        exit;
    }
    echo '<h1>Dashboard</h1>';
    echo '<p>Welcome, ' . htmlspecialchars($_SESSION['user']['username']) . '!</p>';
    echo '<a href="/logout">Logout</a>';
    exit;
}

// Home page
?>
<!doctype html>
<html lang="en">
  <head><title>AuthKit example</title></head>
  <body>
    <h1>AuthKit example</h1>
    <form method="POST" action="/login">
      <input type="text" name="username" placeholder="Username">
      <input type="password" name="password" placeholder="Password">
      <button type="submit">Sign in</button>
    </form>
    <p><a href="/logout">Sign out</a></p>
  </body>
</html>
