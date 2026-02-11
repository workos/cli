package main

import (
	"context"
	"encoding/json"
	"net/http"
	"os"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"golang.org/x/oauth2"
)

var (
	oauth2Config oauth2.Config
	oidcProvider *oidc.Provider
)

func main() {
	godotenv.Load()

	ctx := context.Background()

	provider, err := oidc.NewProvider(ctx, "https://"+os.Getenv("AUTH0_DOMAIN")+"/")
	if err != nil {
		panic(err)
	}
	oidcProvider = provider

	oauth2Config = oauth2.Config{
		ClientID:     os.Getenv("AUTH0_CLIENT_ID"),
		ClientSecret: os.Getenv("AUTH0_CLIENT_SECRET"),
		RedirectURL:  "http://localhost:3000/callback",
		Endpoint:     provider.Endpoint(),
		Scopes:       []string{oidc.ScopeOpenID, "profile", "email"},
	}

	r := gin.Default()

	r.GET("/", func(c *gin.Context) {
		c.File("./index.html")
	})

	r.GET("/api/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok", "version": "1.0.0"})
	})

	r.GET("/login", func(c *gin.Context) {
		c.Redirect(http.StatusTemporaryRedirect, oauth2Config.AuthCodeURL("state"))
	})

	r.GET("/callback", func(c *gin.Context) {
		token, err := oauth2Config.Exchange(c.Request.Context(), c.Query("code"))
		if err != nil {
			c.String(http.StatusInternalServerError, "Token exchange failed: "+err.Error())
			return
		}

		rawIDToken, ok := token.Extra("id_token").(string)
		if !ok {
			c.String(http.StatusInternalServerError, "No id_token in response")
			return
		}

		verifier := oidcProvider.Verifier(&oidc.Config{ClientID: oauth2Config.ClientID})
		idToken, err := verifier.Verify(c.Request.Context(), rawIDToken)
		if err != nil {
			c.String(http.StatusInternalServerError, "Token verification failed: "+err.Error())
			return
		}

		var claims map[string]interface{}
		idToken.Claims(&claims)

		userJSON, _ := json.Marshal(claims)
		c.SetCookie("user", string(userJSON), 3600, "/", "", false, true)
		c.Redirect(http.StatusTemporaryRedirect, "/")
	})

	r.GET("/logout", func(c *gin.Context) {
		c.SetCookie("user", "", -1, "/", "", false, true)
		c.Redirect(http.StatusTemporaryRedirect, "/")
	})

	r.Run(":3000")
}
