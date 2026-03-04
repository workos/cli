<?php

return [
    'api_key' => env('WORKOS_API_KEY', ''),
    'client_id' => env('WORKOS_CLIENT_ID', ''),
    'redirect_uri' => env('WORKOS_REDIRECT_URI', 'http://localhost:8000/auth/callback'),
];
