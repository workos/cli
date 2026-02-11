package com.example

import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Controller
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.servlet.view.RedirectView
import jakarta.servlet.http.HttpSession
import jakarta.servlet.http.HttpServletRequest

@Controller
class AuthController(
    @Value("\${auth0.domain}") private val auth0Domain: String,
    @Value("\${auth0.clientId}") private val clientId: String,
    @Value("\${auth0.clientSecret}") private val clientSecret: String,
) {
    @GetMapping("/api/health")
    @org.springframework.web.bind.annotation.ResponseBody
    fun health(): Map<String, String> {
        return mapOf("status" to "ok", "version" to "1.0.0")
    }

    @GetMapping("/login")
    fun login(): RedirectView {
        val authorizeUrl = "https://$auth0Domain/authorize?" +
            "client_id=$clientId&redirect_uri=http://localhost:8080/callback&response_type=code&scope=openid profile email"
        return RedirectView(authorizeUrl)
    }

    @GetMapping("/callback")
    fun callback(request: HttpServletRequest, session: HttpSession): RedirectView {
        val code = request.getParameter("code")
        // In a real app, exchange code for tokens via Auth0 API
        session.setAttribute("user", mapOf("code" to code))
        return RedirectView("/")
    }

    @GetMapping("/logout")
    fun logout(session: HttpSession): RedirectView {
        session.invalidate()
        return RedirectView("/")
    }
}
