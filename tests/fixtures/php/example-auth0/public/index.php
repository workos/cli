<?php

require_once __DIR__ . '/../vendor/autoload.php';

use Auth0\SDK\Auth0;
use Dotenv\Dotenv;

session_start();

$dotenv = Dotenv::createImmutable(__DIR__ . '/..');
$dotenv->load();

$auth0 = new Auth0([
    'domain' => $_ENV['AUTH0_DOMAIN'],
    'clientId' => $_ENV['AUTH0_CLIENT_ID'],
    'clientSecret' => $_ENV['AUTH0_CLIENT_SECRET'],
    'cookieSecret' => $_ENV['AUTH0_COOKIE_SECRET'],
]);

$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

switch ($path) {
    case '/api/health':
        header('Content-Type: application/json');
        echo json_encode(['status' => 'ok', 'version' => '1.0.0']);
        exit;

    case '/login':
        $auth0->clear();
        header('Location: ' . $auth0->login(
            $_ENV['AUTH0_CALLBACK_URL']
        ));
        exit;

    case '/callback':
        $auth0->exchange(
            $_ENV['AUTH0_CALLBACK_URL']
        );
        $_SESSION['user'] = $auth0->getUser();
        header('Location: /');
        exit;

    case '/logout':
        $auth0->logout();
        session_destroy();
        header('Location: ' . $auth0->getLogoutLink(
            $_ENV['AUTH0_CALLBACK_URL']
        ));
        exit;
}

$user = $_SESSION['user'] ?? null;
?>
<!doctype html>
<html lang="en">
  <head><title>AuthKit example</title></head>
  <body>
    <h1>AuthKit example</h1>
    <?php if ($user): ?>
      <p>Welcome, <?= htmlspecialchars($user['name'] ?? $user['email']) ?></p>
      <p><a href="/logout">Sign out</a></p>
    <?php else: ?>
      <p><a href="/login">Sign in</a></p>
    <?php endif; ?>
  </body>
</html>
