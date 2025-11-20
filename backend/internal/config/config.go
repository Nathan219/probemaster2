package config

import (
	"os"
)

type Config struct {
	ServerAddr string

	Version string
}

func Load() Config {
	get := func(k, d string) string {
		if v := os.Getenv(k); v != "" {
			return v
		}
		return d
	}

	cfg := Config{
		ServerAddr: get("SERVER_ADDR", ":8080"),

		Version: get("VERSION", "1.0"),
	}
	return cfg
}
