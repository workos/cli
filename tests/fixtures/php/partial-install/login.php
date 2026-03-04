<?php

require_once __DIR__ . '/vendor/autoload.php';

$dotenv = Dotenv\Dotenv::createImmutable(__DIR__);
$dotenv->load();

$workos = new \WorkOS\WorkOS($_ENV['WORKOS_API_KEY']);

// TODO: redirect user to authorization URL
http_response_code(501);
echo 'Not implemented';
