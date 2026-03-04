package com.example

import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController
import java.security.Principal

@RestController
class DashboardController {

    @GetMapping("/dashboard")
    fun dashboard(principal: Principal): Map<String, String> {
        return mapOf("message" to "Welcome, ${principal.name}!")
    }

    @GetMapping("/api/health")
    fun health(): Map<String, String> {
        return mapOf("status" to "ok", "version" to "1.0.0")
    }
}
