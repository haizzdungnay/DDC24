package app

import (
	"context"
	"errors"
	"fmt"
	"log"
	webModbus "mkddc-web/internal/modbusrtu"
	programmingapplication "mkddc-web/internal/programming/application"
	programmingartifact "mkddc-web/internal/programming/artifact"
	programmingcompiler "mkddc-web/internal/programming/compiler"
	programmingcoreipc "mkddc-web/internal/programming/coreipc"
	programmingstore "mkddc-web/internal/programming/store"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
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
	historianAuthorityMu   sync.RWMutex
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
	activity               *ActivityStore
	overrides              *OverrideRegistry
	virtualPointRuntime    *HistorianRuntimeRegistry
	pointMigrationWriter   func(string, []byte, os.FileMode) error
	pointNamespaceWriter   func(string, []byte, os.FileMode) error
	reloadDispatcher       func(string) (bool, []string)
	// Modbus RTU v2 (MBR-B203/B208/B305)
	modbusOnce            sync.Once
	modbusCandidates      *webModbus.CandidateStore
	modbusEvents          modbusEventLog
	commissionLimit       commissionLimiter
	programmingStore      *programmingstore.Store
	programmingProjects   *programmingapplication.ProjectService
	programmingLibrary    *programmingapplication.LibraryService
	programmingChecks     *programmingapplication.CheckService
	programmingOperations *programmingapplication.OperationService
	programmingRuntime    *programmingapplication.RuntimeService
	programmingIntents    *programmingapplication.RuntimeIntentService
	// Plan 57 Wave 3
	preferences   *UserPreferenceStore
	systemHistory *SystemHistoryRing
	startedAt     time.Time
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
	cfg.deriveProgrammingPaths()
	app := &App{cfg: cfg, logger: logger, audit: audit, auth: auth, core: core, netcfg: NewNetcfgClient(cfg.NetcfgSock), os: osReader, time: NewSystemTimeService(), virtualPointRuntime: NewHistorianRuntimeRegistry(), historianAuthority: HistorianRuntimeAuthority{State: "legacy", LegacyWriterAllowed: true}, legacyState: "stopped"}
	if cfg.ProgrammingRevA {
		store, openErr := programmingstore.OpenProgrammingStore(context.Background(), programmingstore.Options{Path: cfg.ProgrammingDBPath, BackupDir: cfg.ProgrammingBackupDir})
		if openErr != nil {
			return nil, fmt.Errorf("mở Programming store: %w", openErr)
		}
		projects, serviceErr := programmingapplication.NewProjectService(store, []byte(cfg.JWTSecret))
		if serviceErr != nil {
			_ = store.Close()
			return nil, fmt.Errorf("khởi tạo Programming Project service: %w", serviceErr)
		}
		artifacts, artifactErr := programmingartifact.NewStore(cfg.ProgrammingArtifactDir)
		if artifactErr != nil {
			_ = store.Close()
			return nil, fmt.Errorf("khởi tạo Programming artifact store: %w", artifactErr)
		}
		checks, checkErr := programmingapplication.NewCheckService(programmingapplication.CheckServiceOptions{
			Store: store, Artifacts: artifacts, TargetID: cfg.ProgrammingTargetID, LeaseDuration: 30 * time.Second,
			Runner: programmingcompiler.ProcessRunner{BinaryPath: cfg.ProgrammingCompilerPath, ScratchRoot: cfg.ProgrammingScratchDir, Timeout: cfg.ProgrammingCompilerTimeout, SigningKeyPath: cfg.ProgrammingSigningKeyPath},
			// T59-302: container package v2 do CHÍNH writer production ghi; BE
			// chỉ điều phối, không cài lại định dạng.
			Packager: programmingcompiler.ProcessPackager{BinaryPath: cfg.ProgrammingPackagerPath, ScratchRoot: cfg.ProgrammingScratchDir, Timeout: cfg.ProgrammingCompilerTimeout},
		})
		if checkErr != nil {
			_ = store.Close()
			return nil, fmt.Errorf("khởi tạo Programming Check service: %w", checkErr)
		}
		operations, operationErr := programmingapplication.NewOperationService(programmingapplication.OperationServiceOptions{
			Store: store, Projects: projects, Artifacts: artifacts,
			Runtime:      programmingcoreipc.NewClient(cfg.ProgrammingSocket, cfg.ProgrammingCoreUID),
			ControllerID: cfg.ProgrammingTargetID, StagingRoot: cfg.ProgrammingStagingDir,
			Lease: 30 * time.Second,
		})
		if operationErr != nil {
			_ = store.Close()
			return nil, fmt.Errorf("khởi tạo Programming Operation service: %w", operationErr)
		}
		runtimeService, runtimeErr := programmingapplication.NewRuntimeService(programmingapplication.RuntimeServiceOptions{
			Runtime:      programmingcoreipc.NewClient(cfg.ProgrammingSocket, cfg.ProgrammingCoreUID),
			Store:        store,
			Catalog:      app.programmingPointCatalog(),
			Monitor:      app.programmingPointCatalog(),
			Overrides:    app.programmingPointCatalog(),
			ControllerID: cfg.ProgrammingTargetID,
			CursorSecret: []byte(cfg.JWTSecret),
		})
		if runtimeErr != nil {
			_ = store.Close()
			return nil, fmt.Errorf("khởi tạo Programming Runtime service: %w", runtimeErr)
		}
		library, libraryErr := programmingapplication.NewLibraryService(store, []byte(cfg.JWTSecret))
		if libraryErr != nil {
			_ = store.Close()
			return nil, fmt.Errorf("khởi tạo Programming Library service: %w", libraryErr)
		}
		intents, intentErr := programmingapplication.NewRuntimeIntentService(
			programmingapplication.RuntimeIntentServiceOptions{
				Store:        store,
				Runtime:      programmingcoreipc.NewClient(cfg.ProgrammingSocket, cfg.ProgrammingCoreUID),
				ControllerID: cfg.ProgrammingTargetID,
			})
		if intentErr != nil {
			_ = store.Close()
			return nil, fmt.Errorf("khởi tạo Programming Runtime Intent service: %w", intentErr)
		}
		app.programmingIntents = intents
		app.programmingStore = store
		app.programmingLibrary = library
		app.programmingProjects = projects
		app.programmingChecks = checks
		app.programmingOperations = operations
		app.programmingRuntime = runtimeService
		checks.Start(context.Background())
		operations.Start(context.Background())
	}
	app.pointNamespaceWriter = writeConfigFileAtomic
	app.overrides = NewOverrideRegistry()
	// PA3-103/104: audit hiện hữu chảy thẳng vào kho Activity. Gắn sink NGAY
	// sau khi tạo store để không có cửa sổ nào mà một lệnh đã được ghi journal
	// nhưng lại vắng mặt trên Landing.
	app.activity = NewActivityStore(app.activityPath())
	audit.SetSink(app.activity)
	// `T57-3.2` / `ADR-043`: tuỳ chọn người dùng nằm cạnh cấu hình, tệp riêng —
	// không trộn vào `users.conf` vốn chứa hash mật khẩu và bị ghi lại toàn bộ
	// mỗi lần đổi tài khoản.
	app.preferences = NewUserPreferenceStore(app.userPreferencesPath())
	// `T57-3.16`: sổ phiên nằm trong bộ nhớ nên chỉ nói được về khoảng thời gian
	// từ lúc tiến trình khởi động. Ghi lại mốc đó để giao diện nói ra giới hạn.
	app.startedAt = time.Now().UTC()
	// `T57-3.4`: vòng nhớ 60 phút cho CPU/RAM/nhiệt độ, lấy mẫu ngay trên đường
	// `/system/status` mà trang Chẩn đoán đã poll.
	app.systemHistory = NewSystemHistoryRing(app.startedAt)
	if err := app.migrateLegacyPointConfig(); err != nil {
		if app.programmingStore != nil {
			app.programmingOperations.Close()
			app.programmingChecks.Close()
			_ = app.programmingStore.Close()
		}
		return nil, err
	}
	app.virtualPointRing = NewVirtualPointRing(10 * time.Minute)
	// F-PROG-ASBUILT-014 (phần READ): sau khi web-api khởi động lại (hoặc Core
	// khởi động lại độc lập), av_[]/bv_[] của Core reset về BAD/0 — không đồng
	// bộ lại ngay thì mọi ST Program bind VP sẽ fail-closed (quality != GOOD)
	// cho tới khi có người vô tình ghi lại giá trị VP. Đẩy một lần khi khởi
	// động, không chặn boot nếu Core chưa sẵn sàng (ForcePointTTL tự degrade).
	app.syncBoundVirtualPointsToCore(context.Background())
	app.alarmHistory = NewAlarmHistoryStore(app.alarmHistoryPath())
	app.alarmTracker = NewAlarmHistoryTracker()
	historian, err := OpenHistorianPolicyService(filepath.Join(cfg.ConfigDir, "historian.conf"), time.Now, func() (uint64, error) { return filesystemFreeBytes(cfg.ConfigDir) })
	if err != nil {
		if app.programmingStore != nil {
			app.programmingOperations.Close()
			app.programmingChecks.Close()
			_ = app.programmingStore.Close()
		}
		return nil, err
	}
	historian.identities = app.historianIdentities
	historian.namespaceRevision = func() (uint64, error) {
		authority, err := app.readPointNamespaceAuthority()
		return authority.Revision, err
	}
	app.historian = historian
	historian.writerActive = app.historianWriterActive
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
				// "degraded" (không chỉ "legacy") cũng phải thử tự bootstrap: đây
				// đúng là trạng thái sau khi historian_activation lệch revision
				// so với historian.conf sống (bug 2026-08-17, xem ghi chú ở
				// mirrorCommitted phía dưới) — nếu chỉ xử lý "legacy" thì một
				// board đã kẹt degraded từ trước sẽ KHÔNG tự hồi phục được dù
				// restart service, phải đợi tới lần sửa policy tiếp theo mới
				// kích hoạt lại qua mirrorCommitted. AutoBootstrapSingleNode tự
				// no-op an toàn nếu lineage hiện tại là một cutover thật.
				if authority, authorityErr := app.historianActivation.Authority(context.Background()); authorityErr == nil && (authority.State == "legacy" || authority.State == "degraded") {
					policyBytes, _ := historian.committedMirrorSnapshot()
					if bootstrapErr := app.historianActivation.AutoBootstrapSingleNode(context.Background(), policyBytes); bootstrapErr != nil {
						logger.Printf("WARN historian_v2 auto-bootstrap failed err=%v", bootstrapErr)
					}
				}
				if authority, authorityErr := app.historianActivation.Authority(context.Background()); authorityErr != nil {
					logger.Printf("WARN historian_v2 activation authority unavailable err=%v", authorityErr)
				} else {
					app.setHistorianAuthority(authority)
				}
				// Bug 2026-08-17: AutoBootstrapSingleNode chỉ chạy MỘT LẦN lúc
				// boot (nhánh authority.State=="legacy" phía trên). Trên board
				// single-node đã tự kích hoạt v2 xong, MỌI lần sửa historian
				// policy sau đó (vd bật "ghi lịch sử" cho một điểm ở /trends)
				// đều làm revision trong historian.conf tăng lên mà không đi
				// qua lại Prepare/Commit — historian_activation trong SQLite
				// kẹt ở revision cũ, Authority() phát hiện lệch → tự degrade
				// VĨNH VIỄN cả WriterV2 lẫn QueryV2 (xem historian_activation.go)
				// dù dữ liệu ghi hoàn toàn bình thường. Gọi lại
				// AutoBootstrapSingleNode sau MỖI lần commit policy để tự đồng
				// bộ lại — hàm này tự bỏ qua (no-op) nếu hệ thống đang ở một
				// lineage cutover thật (không phải bootstrap đơn-node) nên
				// không đụng tới luồng migration đa-node nghiêm ngặt.
				historian.mirrorCommitted = func(ctx context.Context, data []byte, namespaceRevision, observedAtUTCMS uint64) error {
					if err := store.MirrorPolicy(ctx, data, namespaceRevision, observedAtUTCMS); err != nil {
						return err
					}
					if err := app.historianActivation.AutoBootstrapSingleNode(ctx, data); err != nil {
						logger.Printf("WARN historian_v2 auto-reconcile after policy update failed err=%v", err)
						return nil
					}
					if authority, authorityErr := app.historianActivation.Authority(ctx); authorityErr == nil {
						app.setHistorianAuthority(authority)
					}
					return nil
				}
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
								app.historianRestartReady = !app.getHistorianAuthority().WriterV2
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

// Main là composition entrypoint của Web API. Package cmd chỉ chuyển quyền
// điều khiển vào đây để toàn bộ lifecycle có thể được test trong internal/app.
func Main() {
	if len(os.Args) == 2 && os.Args[1] == "--version" {
		fmt.Printf("version=%s git_commit=%s build_time=%s toolchain=%s runtime=%s\n", buildVersion, buildGitCommit, buildTime, buildToolchain, runtime.Version())
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
	if len(os.Args) == 2 && os.Args[1] == "reload-helper-server" {
		if err := runReloadHelperServer(); err != nil {
			log.Printf("reload-helper-server: %v", err)
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

	/* Di trú lịch v1 → v3.1 CHẠY TRƯỚC khi mở cổng nghe.
	 *
	 * Nếu chạy sau, có một cửa sổ thời gian mà API đã nhận request trong khi
	 * schedule.conf còn định dạng cũ: `GET /schedules` trả 409, và tệ hơn là
	 * một `PUT` lọt vào giữa chừng sẽ ghi đè tệp v1 trước khi nó kịp được
	 * đọc để di trú — mất sạch lịch cũ mà không có gì báo.
	 *
	 * Lỗi được phát hiện khi kiểm trên bo Foxlinx 2026-08-07: hàm này đã viết
	 * xong và có test, nhưng KHÔNG AI GỌI, nên bo có cấu hình cũ kẹt 409 vĩnh
	 * viễn. Test gọi thẳng `MigrateSchedulesOnStartup` nên không thấy. */
	if notes, err := app.MigrateSchedulesOnStartup(ctx); err != nil {
		logger.Printf("ERROR schedule.migrate.failed err=%v", err)
	} else {
		for _, n := range notes {
			logger.Printf("INFO schedule.migrate %s", n)
		}
	}

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
		a.StartAlarmHistory(ctx)
		// `ADR-036` điều kiện tiên quyết: `alarm_history.jsonl` trước đây không
		// có xoay vòng và không có retention. Bật cắt định kỳ TRƯỚC khi mở màn
		// hình chỉ số `T57-3.3`, vì chính màn hình đó quét tệp này.
		a.StartAlarmHistoryPrune(ctx)
	}
}

func (a *App) Close() error {
	if a == nil {
		return nil
	}
	var trendErr, historianErr, programmingErr error
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
	if a.programmingStore != nil {
		if a.programmingOperations != nil {
			a.programmingOperations.Close()
		}
		if a.programmingChecks != nil {
			a.programmingChecks.Close()
		}
		programmingErr = a.programmingStore.Close()
	}
	return errors.Join(trendErr, historianErr, programmingErr)
}
