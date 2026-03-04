package main

import (
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/workos/workos-go/v4/pkg/usermanagement"
)

func init() {
	godotenv.Load()
	usermanagement.SetAPIKey(os.Getenv("WORKOS_API_KEY"))
}

func main() {
	r := gin.Default()

	r.GET("/", func(c *gin.Context) {
		c.File("./index.html")
	})

	r.GET("/auth/login", func(c *gin.Context) {
		// TODO: redirect user to authorization URL
		c.String(http.StatusNotImplemented, "Not implemented")
	})

	// TODO: implement /auth/callback handler

	r.GET("/api/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok", "version": "1.0.0"})
	})

	r.Run(":3000")
}
