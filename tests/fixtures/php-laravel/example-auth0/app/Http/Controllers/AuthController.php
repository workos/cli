<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Auth0\Laravel\Facade\Auth0;

class AuthController extends Controller
{
    public function home()
    {
        $user = Auth0::getUser();
        return view('home', ['user' => $user]);
    }

    public function login()
    {
        return Auth0::login();
    }

    public function callback()
    {
        Auth0::callback();
        return redirect('/');
    }

    public function logout()
    {
        Auth0::logout();
        return redirect('/');
    }
}
