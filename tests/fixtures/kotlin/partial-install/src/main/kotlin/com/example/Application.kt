package com.example

import com.workos.WorkOS
import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication

@SpringBootApplication
class Application

// TODO: Create auth controller with login, callback, and logout endpoints
val workos = WorkOS(System.getenv("WORKOS_API_KEY") ?: "")

fun main(args: Array<String>) {
    runApplication<Application>(*args)
}
