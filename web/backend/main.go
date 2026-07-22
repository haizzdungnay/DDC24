package main

import (
	"context"
	"errors"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"
)

type App struct {
	cfg              Config
	logger           *log.Logger
	audit            *AuditLogger
	auth             *AuthService
	core             CoreStatusClient
	os               OSReader
	trends           *TrendStore
	sampler          *Sampler
	virtualPointRing *VirtualPointRing
	alarmHistory     *AlarmHistoryStore
	alarmTracker     *AlarmHistoryTracker
	virtualPointMu   sync.Mutex
}

func NewApp(cfg Config, logger *log.Logger, core CoreStatusClient, osReader OSReader) (*App, error) {
	if logger == nil {
		logger = log.Default()
	}
	audit := NewAuditLogger(logger)
	auth, err := NewAuthService(cfg, audit)
	if err != nil {
		return nil, err
	}
	if core == nil {
		core = NewCoreClient(cfg)
	}
	if osReader == nil {
		osReader = NewDefaultOSReader()
	}
	app := &App{cfg: cfg, logger: logger, audit: audit, auth: auth, core: core, os: osReader}
	app.virtualPointRing = NewVirtualPointRing(10 * time.Minute)
	app.alarmHistory = NewAlarmHistoryStore(app.alarmHistoryPath())
	app.alarmTracker = NewAlarmHistoryTracker()
	if cfg.TrendDBPath == "" {
		return app, nil
	}
	store, err := OpenTrendStore(cfg.TrendDBPath)
	if err != nil {
		logger.Printf("WARN trend_store disabled err=%v", err)
		return app, nil
	}
	app.trends = store
	if _, ok := core.(pointReader); ok {
		trendCfg, err := store.GetConfig(context.Background())
		if err != nil {
			logger.Printf("WARN trend_config defaulted err=%v", err)
			trendCfg = defaultTrendConfig()
		}
		app.sampler = NewSampler(store, app, trendCfg, logger)
	}
	return app, nil
}

func main() {
	logger := log.New(os.Stdout, "mkddc-web ", log.LstdFlags|log.LUTC)
	cfg, err := LoadConfig()
	if err != nil {
		logger.Fatalf("config: %v", err)
	}
	app, err := NewApp(cfg, logger, nil, nil)
	if err != nil {
		logger.Fatalf("init: %v", err)
	}
	server := &http.Server{
		Addr:              cfg.Addr,
		Handler:           app.Router(),
		ReadHeaderTimeout: 5 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	hmiBroker := NewHMIBroker(cfg, app.auth, NewCoreClient(cfg), logger, app.audit)
	go func() {
		if err := hmiBroker.Serve(ctx); err != nil && ctx.Err() == nil {
			logger.Printf("ERROR hmi_ipc_stopped reason=%v", err)
		}
	}()

	go func() {
		logger.Printf("INFO listen addr=%s core_sock=%s users_conf=%s trend_db=%s", cfg.Addr, cfg.CoreSock, cfg.UsersConf, cfg.TrendDBPath)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Fatalf("serve: %v", err)
		}
	}()
	app.StartSampler(ctx)

	<-ctx.Done()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Printf("ERROR shutdown err=%v", err)
	}
	if err := hmiBroker.Close(); err != nil && !errors.Is(err, net.ErrClosed) {
		logger.Printf("WARN hmi_ipc_close err=%v", err)
	}
	if err := app.Close(); err != nil {
		logger.Printf("ERROR close err=%v", err)
	}
}

func (a *App) StartSampler(ctx context.Context) {
	if a != nil && a.sampler != nil {
		a.sampler.Start(ctx)
	}
	if a != nil {
		a.StartVirtualPointSampler(ctx)
		a.StartVirtualPointScheduler(ctx)
		a.StartAlarmHistory(ctx)
	}
}

func (a *App) Close() error {
	if a == nil || a.trends == nil {
		return nil
	}
	return a.trends.Close()
}
