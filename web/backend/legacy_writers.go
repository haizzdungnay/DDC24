package main

import (
	"context"
	"errors"
	"fmt"
	"time"
)

func (a *App) StartLegacyHistorianWriters(ctx context.Context) error {
	if a == nil {
		return nil
	}
	a.legacyMu.Lock()
	defer a.legacyMu.Unlock()
	if !a.historianAuthority.LegacyWriterAllowed {
		a.legacyState = "stopped"
		return nil
	}
	if a.legacyState == "running" {
		return nil
	}
	if a.legacyState == "quiescing" || a.legacyState == "quiesced" {
		return ErrHistorianQuiesceConflict
	}
	if a.historianV2 != nil {
		if err := a.historianV2.InvalidateLegacyHistorianQuiesceForResume(ctx, time.Now().UTC().UnixMilli()); err != nil {
			return err
		}
	}
	a.legacyCtx = ctx
	if a.trends != nil {
		a.trends.ResumeWriters()
	}
	if a.sampler != nil {
		a.sampler.Start(ctx)
	}
	a.startVirtualPointSamplerLocked(ctx)
	a.legacyState = "running"
	return nil
}

func (a *App) QuiesceLegacyHistorianWriters(ctx context.Context) (LegacyQuiesceProof, error) {
	if a == nil || a.trends == nil || a.historianV2 == nil {
		return LegacyQuiesceProof{}, fmt.Errorf("historian maintenance dependencies unavailable")
	}
	a.legacyMu.Lock()
	if a.legacyState == "quiesced" {
		proof := a.legacyProof
		a.legacyMu.Unlock()
		return proof, nil
	}
	if a.legacyState == "quiescing" {
		a.legacyMu.Unlock()
		return LegacyQuiesceProof{}, ErrHistorianQuiesceConflict
	}
	a.legacyState = "quiescing"
	a.legacyMu.Unlock()

	if err := a.trends.QuiesceWriters(ctx); err != nil {
		a.legacyMu.Lock()
		a.legacyState = "running"
		a.legacyMu.Unlock()
		return LegacyQuiesceProof{}, err
	}
	if a.sampler != nil {
		if err := a.sampler.Stop(ctx); err != nil {
			return LegacyQuiesceProof{}, err
		}
	}
	if err := a.stopVirtualPointSampler(ctx); err != nil {
		return LegacyQuiesceProof{}, err
	}
	token, err := newLegacyQuiesceToken()
	if err != nil {
		return LegacyQuiesceProof{}, err
	}
	stoppedAt := time.Now().UTC().UnixMilli()
	proof, err := a.historianV2.RecordLegacyHistorianQuiesce(ctx, token, a.trends.path, stoppedAt)
	if err != nil {
		a.resumeLegacyAfterFailedQuiesce()
		return LegacyQuiesceProof{}, err
	}
	a.legacyMu.Lock()
	a.legacyEpoch = proof.Epoch
	a.legacyProof = proof
	a.legacyState = "quiesced"
	a.legacyMu.Unlock()
	return proof, nil
}

func (a *App) ResumeLegacyHistorianWriters(ctx context.Context, proof LegacyQuiesceProof) error {
	if a == nil {
		return nil
	}
	a.legacyMu.Lock()
	if a.legacyState != "quiesced" || a.legacyProof.Epoch != proof.Epoch || !equalBytes(a.legacyProof.TokenSHA256, proof.TokenSHA256) {
		a.legacyMu.Unlock()
		return ErrHistorianQuiesceConflict
	}
	if !a.historianAuthority.LegacyWriterAllowed {
		a.legacyMu.Unlock()
		return fmt.Errorf("legacy writer resume forbidden after v2 activation")
	}
	a.legacyMu.Unlock()
	if a.historianV2 != nil {
		if err := a.historianV2.AbandonLegacyHistorianQuiesce(ctx, proof, time.Now().UTC().UnixMilli()); err != nil {
			return err
		}
	}
	a.legacyMu.Lock()
	a.legacyProof = LegacyQuiesceProof{}
	a.legacyState = "stopped"
	runtimeCtx := a.legacyCtx
	a.legacyMu.Unlock()
	if runtimeCtx == nil {
		runtimeCtx = context.Background()
	}
	return a.StartLegacyHistorianWriters(runtimeCtx)
}

func (a *App) resumeLegacyAfterFailedQuiesce() {
	a.trends.ResumeWriters()
	a.legacyMu.Lock()
	runtimeCtx := a.legacyCtx
	if runtimeCtx == nil {
		runtimeCtx = context.Background()
	}
	if a.sampler != nil {
		a.sampler.Start(runtimeCtx)
	}
	a.startVirtualPointSamplerLocked(runtimeCtx)
	a.legacyState = "running"
	a.legacyMu.Unlock()
}

func (a *App) LegacyHistorianWritersQuiesced() bool {
	if a == nil {
		return true
	}
	a.legacyMu.Lock()
	defer a.legacyMu.Unlock()
	return a.legacyState == "quiesced"
}

func (a *App) stopLegacyHistorianWriters(ctx context.Context) error {
	if a == nil {
		return nil
	}
	var result error
	if a.trends != nil {
		result = errors.Join(result, a.trends.QuiesceWriters(ctx))
	}
	if a.sampler != nil {
		result = errors.Join(result, a.sampler.Stop(ctx))
	}
	result = errors.Join(result, a.stopVirtualPointSampler(ctx))
	a.legacyMu.Lock()
	if result == nil {
		a.legacyState = "stopped"
	}
	a.legacyMu.Unlock()
	return result
}

func (a *App) startVirtualPointSamplerLocked(ctx context.Context) {
	if a.trends == nil || a.legacyVPCancel != nil {
		return
	}
	runCtx, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	a.legacyVPCancel, a.legacyVPDone = cancel, done
	go func() {
		defer close(done)
		a.runVirtualPointSampler(runCtx)
	}()
}

func (a *App) stopVirtualPointSampler(ctx context.Context) error {
	a.legacyMu.Lock()
	cancel, done := a.legacyVPCancel, a.legacyVPDone
	a.legacyMu.Unlock()
	if cancel == nil {
		return nil
	}
	cancel()
	select {
	case <-done:
		a.legacyMu.Lock()
		if a.legacyVPDone == done {
			a.legacyVPCancel, a.legacyVPDone = nil, nil
		}
		a.legacyMu.Unlock()
		return nil
	case <-ctx.Done():
		return fmt.Errorf("stop legacy virtual-point sampler: %w", ctx.Err())
	}
}
