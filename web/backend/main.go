package main

import (
	"context"
	"errors"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"sync"
	"syscall"
	"time"
)

type App struct {
	cfg                    Config
	logger                 *log.Logger
	audit                  *AuditLogger
	auth                   *AuthService
	core                   CoreStatusClient
	netcfg                 netcfgAuthority
	os                     OSReader
	time                   TimeService
	trends                 *TrendStore
	historian              *HistorianPolicyService
	historianV2            *HistorianStore
	historianTrendCache    *HistorianTrendCache
	historianV2Ready       bool
	historianActivation    *HistorianActivationCoordinator
	historianAuthority     HistorianRuntimeAuthority
	historianShadow        *HistorianShadowScheduler
	historianRestartReady  bool
	historianShadowMono    uint64
	historianShadowStart   time.Time
	historianShadowRuntime *historianShadowRuntime
	historianShadowMu      sync.RWMutex
	historianCancel        context.CancelFunc
	historianWG            sync.WaitGroup
	legacyMu               sync.Mutex
	legacyCtx              context.Context
	legacyVPCancel         context.CancelFunc
	legacyVPDone           chan struct{}
	legacyState            string
	legacyEpoch            uint64
	legacyProof            LegacyQuiesceProof
	maintenanceMu          sync.Mutex
	sampler                *Sampler
	virtualPointRing       *VirtualPointRing
	alarmHistory           *AlarmHistoryStore
	alarmTracker           *AlarmHistoryTracker
	pointConfigMu          sync.Mutex
	virtualPointRuntime    *HistorianRuntimeRegistry
	pointMigrationWriter   func(string, []byte, os.FileMode) error
	pointNamespaceWriter   func(string, []byte, os.FileMode) error
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
	app := &App{cfg: cfg, logger: logger, audit: audit, auth: auth, core: core, netcfg: NewNetcfgClient(cfg.NetcfgSock), os: osReader, time: NewSystemTimeService(), virtualPointRuntime: NewHistorianRuntimeRegistry(), historianAuthority: HistorianRuntimeAuthority{State: "legacy", LegacyWriterAllowed: true}, legacyState: "stopped"}
	app.pointNamespaceWriter = writeConfigFileAtomic
	if err := app.migrateLegacyPointConfig(); err != nil {
		return nil, err
	}
	app.virtualPointRing = NewVirtualPointRing(10 * time.Minute)
	app.alarmHistory = NewAlarmHistoryStore(app.alarmHistoryPath())
	app.alarmTracker = NewAlarmHistoryTracker()
	historian, err := OpenHistorianPolicyService(filepath.Join(cfg.ConfigDir, "historian.conf"), time.Now, func() (uint64, error) { return filesystemFreeBytes(cfg.ConfigDir) })
	if err != nil {
		return nil, err
	}
	historian.identities = app.historianIdentities
	historian.namespaceRevision = func() (uint64, error) {
		authority, err := app.readPointNamespaceAuthority()
		return authority.Revision, err
	}
	app.historian = historian
	historian.writerActive = func() bool { return app.historianAuthority.WriterV2 }
	if cfg.HistorianV2DBPath != "" {
		recovery, recoveryErr := HistorianRecoveryPreflight(cfg.HistorianV2DBPath)
		if recoveryErr != nil {
			logger.Printf("WARN historian_v2 disabled action=%s evidence=%s err=%v", recovery.Action, recovery.EvidenceDir, recoveryErr)
		} else {
			store, openErr := OpenHistorianStore(cfg.HistorianV2DBPath)
			if openErr != nil {
				logger.Printf("WARN historian_v2 disabled err=%v", openErr)
			} else {
				app.historianV2 = store
				app.historianV2Ready = true
				app.historianTrendCache = NewHistorianTrendCache()
				if cacheErr := app.historianTrendCache.Warm(context.Background(), store, time.Now().UTC().UnixMilli()); cacheErr != nil {
					logger.Printf("WARN historian_v2 trend cache warmup failed err=%v", cacheErr)
				}
				app.historianActivation = NewHistorianActivationCoordinator(filepath.Join(cfg.ConfigDir, "historian.conf"), store)
				if reconcileErr := app.historianActivation.Reconcile(context.Background()); reconcileErr != nil && !errors.Is(reconcileErr, ErrHistorianActivationPending) {
					logger.Printf("WARN historian_v2 activation reconciliation failed err=%v", reconcileErr)
				}
				if authority, authorityErr := app.historianActivation.Authority(context.Background()); authorityErr != nil {
					logger.Printf("WARN historian_v2 activation authority unavailable err=%v", authorityErr)
				} else {
					app.historianAuthority = authority
				}
				historian.mirrorCommitted = store.MirrorPolicy
				data, _ := historian.committedMirrorSnapshot()
				namespaceRevision, revisionErr := historian.namespaceRevision()
				if revisionErr != nil || store.MirrorPolicy(context.Background(), data, namespaceRevision, uint64(time.Now().UTC().UnixMilli())) != nil {
					logger.Printf("WARN historian_v2 policy mirror pending")
				}
				if physicalReader, ok := core.(historianSnapshotReader); ok {
					snapshotReader := historianRuntimeSnapshotReader{physical: physicalReader, virtual: app.virtualPointRuntime}
					config, configErr := historian.Get()
					if configErr == nil && config.Revision > 0 {
						snapshot, snapshotErr := snapshotReader.ReadPointSnapshot(context.Background())
						anchorUTC, parseErr := time.Parse(time.RFC3339Nano, snapshot.SnapshotObservedAtUTC)
						if snapshotErr == nil && parseErr == nil {
							sink := historianCachingSink{store: store, cache: app.historianTrendCache}
							shadow, shadowErr := NewHistorianShadowScheduler(config, snapshotReader, sink, anchorUTC, snapshot.CapturedMonotonicNs)
							if shadowErr == nil {
								shadow.AttachTrendCache(app.historianTrendCache)
								app.historianShadow = shadow
								app.historianRestartReady = !app.historianAuthority.WriterV2
								app.historianShadowMono = snapshot.CapturedMonotonicNs
								app.historianShadowStart = time.Now()
							} else {
								logger.Printf("WARN historian_v2 shadow scheduler disabled err=%v", shadowErr)
							}
						}
					}
				}
			}
		}
	}
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
	if len(os.Args) >= 2 && os.Args[1] == "rbac-target-smoke" {
		if err := runRBACTargetSmokeCommand(os.Args[2:], os.Stdin, os.Stdout); err != nil {
			log.Printf("rbac-target-smoke: %v", err)
			os.Exit(1)
		}
		return
	}
	if len(os.Args) >= 2 && os.Args[1] == "rbac-users-migrate" {
		if err := runRBACUsersMigrateCommand(os.Args[2:], os.Stdout); err != nil {
			log.Printf("rbac-users-migrate: %v", err)
			os.Exit(1)
		}
		return
	}
	if len(os.Args) >= 2 && os.Args[1] == "rbac-users-rollback" {
		if err := runRBACUsersRollbackCommand(os.Args[2:], os.Stdout); err != nil {
			log.Printf("rbac-users-rollback: %v", err)
			os.Exit(1)
		}
		return
	}
	if len(os.Args) >= 2 && os.Args[1] == "rbac-smoke-users-provision" {
		if err := runRBACSmokeUsersProvisionCommand(os.Args[2:], os.Stdout); err != nil {
			log.Printf("rbac-smoke-users-provision: %v", err)
			os.Exit(1)
		}
		return
	}
	if len(os.Args) >= 2 && os.Args[1] == "rbac-smoke-users-cleanup" {
		if err := runRBACSmokeUsersCleanupCommand(os.Args[2:], os.Stdout); err != nil {
			log.Printf("rbac-smoke-users-cleanup: %v", err)
			os.Exit(1)
		}
		return
	}
	if len(os.Args) >= 2 && os.Args[1] == "historian-rollback-package" {
		if err := runHistorianRollbackPackageCommand(os.Args[2:], os.Stdout); err != nil {
			log.Printf("historian-rollback-package: %v", err)
			os.Exit(1)
		}
		return
	}
	if len(os.Args) >= 2 && os.Args[1] == "historian-rollback-verify" {
		if err := runHistorianRollbackVerifyCommand(os.Args[2:], os.Stdout); err != nil {
			log.Printf("historian-rollback-verify: %v", err)
			os.Exit(1)
		}
		return
	}
	if len(os.Args) >= 2 && os.Args[1] == "historian-maintenance" {
		if err := runHistorianMaintenanceCommand(os.Args[2:], os.Stdout, os.Stderr); err != nil {
			log.Printf("historian-maintenance: %v", err)
			os.Exit(1)
		}
		return
	}
	if len(os.Args) == 2 && os.Args[1] == "time-helper-server" {
		if err := runTimeHelperServer(); err != nil {
			log.Printf("time-helper-server: %v", err)
			os.Exit(1)
		}
		return
	}
	if len(os.Args) >= 2 && os.Args[1] == "time-helper" {
		if len(os.Args) != 3 {
			log.Printf("time-helper: exactly one encoded request is required")
			os.Exit(2)
		}
		if err := runTimeHelper(os.Args[2]); err != nil {
			log.Printf("time-helper: %v", err)
			os.Exit(1)
		}
		return
	}
	logger := log.New(os.Stdout, "mkddc-web ", log.LstdFlags|log.LUTC)
	cfg, err := LoadConfig()
	if err != nil {
		logger.Fatalf("config: %v", err)
	}
	releasePresence, err := createServicePresenceFile(filepath.Join(cfg.ConfigDir, "mkddc-web.running"))
	if err != nil {
		logger.Fatalf("service presence: %v", err)
	}
	defer releasePresence()
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
	if a != nil {
		_ = a.StartLegacyHistorianWriters(ctx)
	}
	if a != nil {
		if a.historianV2 != nil {
			historianCtx, cancel := context.WithCancel(ctx)
			a.historianCancel = cancel
			a.historianWG.Add(1)
			go func() {
				defer a.historianWG.Done()
				a.runHistorianShadowScheduler(historianCtx)
			}()
		}
		a.StartVirtualPointScheduler(ctx)
		a.StartAlarmHistory(ctx)
	}
}

func (a *App) Close() error {
	if a == nil {
		return nil
	}
	var trendErr, historianErr error
	if a.legacyState == "running" || a.legacyState == "quiescing" {
		quiesceCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		_ = a.stopLegacyHistorianWriters(quiesceCtx)
		cancel()
	}
	if a.historianCancel != nil {
		a.historianCancel()
		a.historianWG.Wait()
	}
	if a.trends != nil {
		trendErr = a.trends.Close()
	}
	if a.historianV2 != nil {
		historianErr = a.historianV2.Close()
	}
	return errors.Join(trendErr, historianErr)
}
