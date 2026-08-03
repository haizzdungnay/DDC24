package app

import webPoints "mkddc-web/internal/points"

const pointNamespaceFile = "point_namespace.conf"

type pointNamespaceAuthority = webPoints.NamespaceAuthority

func (a *App) pointNamespaceStore() webPoints.NamespaceStore {
	writer := a.pointNamespaceWriter
	if writer == nil {
		writer = writeConfigFileAtomic
	}
	return webPoints.NamespaceStore{Path: a.configPath(pointNamespaceFile), Writer: writer}
}

func (a *App) readPointNamespaceAuthority() (pointNamespaceAuthority, error) {
	return a.pointNamespaceStore().Read()
}

func (a *App) writePointNamespaceAuthority(authority pointNamespaceAuthority) error {
	return a.pointNamespaceStore().Write(authority)
}
