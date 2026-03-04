package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
)

var jwtSecret []byte

func init() {
	godotenv.Load()
	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		secret = "super-secret-key"
	}
	jwtSecret = []byte(secret)
}

type Claims struct {
	Username string `json:"username"`
	Exp      int64  `json:"exp"`
}

func signJWT(username string) (string, error) {
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	claims := Claims{Username: username, Exp: time.Now().Add(24 * time.Hour).Unix()}
	claimsJSON, _ := json.Marshal(claims)
	payload := base64.RawURLEncoding.EncodeToString(claimsJSON)

	mac := hmac.New(sha256.New, jwtSecret)
	mac.Write([]byte(header + "." + payload))
	signature := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))

	return header + "." + payload + "." + signature, nil
}

func verifyJWT(tokenStr string) (*Claims, error) {
	parts := strings.Split(tokenStr, ".")
	if len(parts) != 3 {
		return nil, fmt.Errorf("invalid token format")
	}

	mac := hmac.New(sha256.New, jwtSecret)
	mac.Write([]byte(parts[0] + "." + parts[1]))
	expectedSig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if expectedSig != parts[2] {
		return nil, fmt.Errorf("invalid signature")
	}

	claimsJSON, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, err
	}

	var claims Claims
	if err := json.Unmarshal(claimsJSON, &claims); err != nil {
		return nil, err
	}

	if time.Now().Unix() > claims.Exp {
		return nil, fmt.Errorf("token expired")
	}

	return &claims, nil
}

func authMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" || !strings.HasPrefix(authHeader, "Bearer ") {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing or invalid token"})
			return
		}
		token := strings.TrimPrefix(authHeader, "Bearer ")
		claims, err := verifyJWT(token)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
			return
		}
		c.Set("username", claims.Username)
		c.Next()
	}
}

func main() {
	r := gin.Default()

	r.GET("/", func(c *gin.Context) {
		c.File("./index.html")
	})

	r.POST("/login", func(c *gin.Context) {
		var body struct {
			Username string `json:"username"`
			Password string `json:"password"`
		}
		if err := c.BindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
			return
		}
		// Hardcoded user for demo
		if body.Username == "admin" && body.Password == "password123" {
			token, _ := signJWT(body.Username)
			c.JSON(http.StatusOK, gin.H{"token": token})
			return
		}
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid credentials"})
	})

	r.GET("/logout", func(c *gin.Context) {
		// JWT is stateless — client discards token
		c.JSON(http.StatusOK, gin.H{"message": "logged out"})
	})

	r.GET("/dashboard", authMiddleware(), func(c *gin.Context) {
		username := c.GetString("username")
		c.JSON(http.StatusOK, gin.H{"message": "Welcome, " + username + "!"})
	})

	r.GET("/api/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok", "version": "1.0.0"})
	})

	r.Run(":3000")
}
