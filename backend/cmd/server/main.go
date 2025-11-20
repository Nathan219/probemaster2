package main

import (
	"log"
	"net/http"

	"github.com/probemaster2/internal/config"
	"github.com/probemaster2/internal/httpapi"
)

func main() {
	cfg := config.Load()

	mux := httpapi.NewRouter(cfg)

	log.Printf("server listening on %s", cfg.ServerAddr)
	log.Printf("Version: %s", cfg.Version)
	if err := http.ListenAndServe(cfg.ServerAddr, mux); err != nil {
		log.Fatal(err)
	}
}
