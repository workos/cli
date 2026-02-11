<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\AuthController;

Route::get('/', [AuthController::class, 'home']);
Route::get('/api/health', function () {
    return response()->json(['status' => 'ok', 'version' => '1.0.0']);
});
Route::get('/login', [AuthController::class, 'login'])->name('login');
Route::get('/callback', [AuthController::class, 'callback']);
Route::get('/logout', [AuthController::class, 'logout'])->name('logout');
