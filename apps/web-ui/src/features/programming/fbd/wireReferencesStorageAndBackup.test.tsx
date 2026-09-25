import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { I18nProvider } from '../../../shared/i18n'
import { StructuredFbdEditor } from './StructuredFbdEditor'
import type { FbdDocument } from './model'
import { describe, expect, it, vi } from 'vitest'
import {
  buildWireReferencesStorageKey,
  loadWireReferencesFromStorage,
  saveWireReferencesToStorage,
  type FbdWireReferenceMap
} from './wireReferences'
import {
  buildPouBackup,
  parsePouBackup,
  planImportPouOperations,
  serializePouBackup
} from '../design/pou/pouBackup'
import type { ProgrammingDraftDocument } from '../model/types'

describe('Module E & B: Storage Isolation & Backup Envelope', () => {
  it('TEST-E-001: Cách ly LocalStorage theo Project & Object (khóa riêng biệt)', () => {
    const mockStorage = (() => {
      const store: Record<string, string> = {}
      return {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => { store[k] = v },
        removeItem: (k: string) => { delete store[k] },
        clear: () => {},
        key: () => null,
        length: 0
      } as Storage
    })()

    const keyProjA = buildWireReferencesStorageKey('proj-A', 'pou-1')
    const keyProjB = buildWireReferencesStorageKey('proj-B', 'pou-1')
    expect(keyProjA).not.toBe(keyProjB)
    expect(keyProjA).toBe('mkddc:fbd-wire-references:v1:proj-A:pou-1')
    expect(keyProjB).toBe('mkddc:fbd-wire-references:v1:proj-B:pou-1')

    const refsA: FbdWireReferenceMap = {
      w1: { wireId: 'w1', signalName: 'SIG_PROJ_A', createdAt: 100 }
    }
    const refsB: FbdWireReferenceMap = {
      w1: { wireId: 'w1', signalName: 'SIG_PROJ_B', createdAt: 200 }
    }

    saveWireReferencesToStorage(refsA, 'proj-A', 'pou-1', mockStorage)
    saveWireReferencesToStorage(refsB, 'proj-B', 'pou-1', mockStorage)

    const loadedA = loadWireReferencesFromStorage('proj-A', 'pou-1', mockStorage)
    const loadedB = loadWireReferencesFromStorage('proj-B', 'pou-1', mockStorage)

    expect(loadedA['w1']?.signalName).toBe('SIG_PROJ_A')
    expect(loadedB['w1']?.signalName).toBe('SIG_PROJ_B')
  })

  it('TEST-E-002: Kháng lỗi QuotaExceeded trong LocalStorage mà không crash', () => {
    const errorStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0
    } as Storage

    const refs: FbdWireReferenceMap = {
      w1: { wireId: 'w1', signalName: 'SIG_TEST', createdAt: 1 }
    }

    expect(() => {
      saveWireReferencesToStorage(refs, 'proj', 'pou', errorStorage)
    }).not.toThrow()
  })

  it('TEST-B-001: Xuất file Backup Envelope chứa presentation.wireReferences', () => {
    const mockStorage = (() => {
      const store: Record<string, string> = {}
      return {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => { store[k] = v },
        removeItem: (k: string) => { delete store[k] },
        clear: () => {},
        key: () => null,
        length: 0
      } as Storage
    })()

    // Lưu reference vào storage trước
    const sampleRefs: FbdWireReferenceMap = {
      'wire-1': { wireId: 'wire-1', signalName: 'SIGNAL_TEMP', createdAt: 500 }
    }
    saveWireReferencesToStorage(sampleRefs, 'proj-1', 'pou-fbd-1', mockStorage)

    // Spy window.localStorage hoặc pass storage
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key) => {
      return mockStorage.getItem(key)
    })

    const draftDoc = {
      schemaVersion: 1,
      project: { projectId: 'proj-1', name: 'Demo Project', functionalTags: [] },
      programs: [
        {
          programId: 'prog-1',
          objectId: 'pou-fbd-1',
          name: 'MainFbd',
          kind: 'PROGRAM',
          language: 'FBD',
          document: '{"networks":[]}'
        }
      ]
    } as unknown as ProgrammingDraftDocument

    const backup = buildPouBackup(draftDoc)
    expect(backup.pous).toHaveLength(1)
    expect(backup.pous[0].presentation?.wireReferences).toBeDefined()
    expect(backup.pous[0].presentation?.wireReferences?.['wire-1']?.signalName).toBe('SIGNAL_TEMP')

    const serialized = serializePouBackup(backup)
    expect(serialized).toContain('SIGNAL_TEMP')

    getItemSpy.mockRestore()
  })

  it('TEST-B-002: Nhập file canonical cũ (Backward Compatibility) nạp thành công và dây hiển thị DIRECT', () => {
    const rawLegacyBackup = JSON.stringify({
      schemaVersion: 'mkddc-pou-backup-v1',
      exportedAt: new Date().toISOString(),
      pous: [
        {
          name: 'LegacyProg',
          kind: 'PROGRAM',
          language: 'FBD',
          document: '{"networks":[]}'
        }
      ]
    })

    const parsed = parsePouBackup(rawLegacyBackup)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    expect(parsed.backup.pous[0].presentation).toBeUndefined()

    const draftDoc = {
      schemaVersion: 1,
      project: { projectId: 'proj-1', name: 'Demo Project', functionalTags: [] },
      programs: []
    } as unknown as ProgrammingDraftDocument

    const plan = planImportPouOperations({
      document: draftDoc,
      itemsToImport: parsed.backup.pous,
      strategy: 'RENAME',
      newObjectIdFactory: () => 'new-uuid-1'
    })

    expect(plan.importedObjectIds).toContain('new-uuid-1')
    expect(plan.operations.some((op) => op.op === 'upsertProgram')).toBe(true)
  })

  it("TEST-E-003: LocalStorage chua JSON hong / rac -> loadWireReferencesFromStorage fallback {} an toan", () => {
    const corruptStorage = {
      getItem: () => "invalid-json{{[",
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 1
    } as Storage

    const loaded = loadWireReferencesFromStorage("proj", "obj", corruptStorage)
    expect(loaded).toEqual({})
  })

  it("TEST-B-003: Round-trip Export -> Import POU voi strategy RENAME -> map dung key objectId moi", () => {
    const mockStorage = (() => {
      const store: Record<string, string> = {}
      return {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => { store[k] = v },
        removeItem: (k: string) => { delete store[k] },
        clear: () => {},
        key: () => null,
        length: 0
      } as Storage
    })()

    // 1. Gia lap luu reference cho POU goc
    const origRefs: FbdWireReferenceMap = {
      "w-orig": { wireId: "w-orig", signalName: "SIG_ORIG", createdAt: 100 }
    }
    saveWireReferencesToStorage(origRefs, "proj-1", "orig-pou-id", mockStorage)

    const getItemSpy = vi.spyOn(Storage.prototype, "getItem").mockImplementation((key) => mockStorage.getItem(key))
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation((key, val) => mockStorage.setItem(key, val))

    const draftDoc = {
      schemaVersion: 1,
      project: { projectId: "proj-1", name: "P1", functionalTags: [] },
      programs: [
        {
          programId: "prog-1",
          objectId: "orig-pou-id",
          name: "MyPOU",
          kind: "PROGRAM",
          language: "FBD",
          document: { graphId: "graph-1", networks: [] }
        }
      ]
    } as unknown as ProgrammingDraftDocument

    // 2. Export
    const backup = buildPouBackup(draftDoc)
    expect(backup.pous[0].presentation?.wireReferences?.["w-orig"]).toBeDefined()

    // 3. Import vao project moi voi strategy RENAME -> sinh objectId moi "new-pou-id"
    const newDraftDoc = {
      schemaVersion: 1,
      project: { projectId: "proj-2", name: "P2", functionalTags: [] },
      programs: [
        {
          programId: "existing-prog",
          objectId: "existing-obj",
          name: "MyPOU", // trung ten de bat RENAME
          kind: "PROGRAM",
          language: "FBD",
          document: "{}"
        }
      ]
    } as unknown as ProgrammingDraftDocument

    const plan = planImportPouOperations({
      document: newDraftDoc,
      itemsToImport: backup.pous,
      strategy: "RENAME",
      newObjectIdFactory: () => "new-pou-id"
    })

    expect(plan.renamedCount).toBe(1)
    expect(plan.importedObjectIds).toContain("new-pou-id")

    // 4. Reference phai duoc luu duoi key objectId moi "new-pou-id"
    const loadedForNewPou = loadWireReferencesFromStorage("proj-2", "new-pou-id", mockStorage)
    expect(loadedForNewPou["w-orig"]?.signalName).toBe("SIG_ORIG")

    getItemSpy.mockRestore()
    setItemSpy.mockRestore()
  })


  it("TEST-SFE-REF-001: StructuredFbdEditor mount nap dung ref tu storage theo objectId", () => {
    const mockStorage = (() => {
      const store: Record<string, string> = {}
      return {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => { store[k] = v },
        removeItem: (k: string) => { delete store[k] },
        clear: () => {},
        key: () => null,
        length: 0
      } as Storage
    })()

    const wireId = "e0000000-0000-4000-8000-000000000001"
    const savedRefs: FbdWireReferenceMap = {
      [wireId]: { wireId, signalName: "MOUNT_LOADED_SIG", createdAt: 1 }
    }
    saveWireReferencesToStorage(savedRefs, "proj-test", "pou-obj-1", mockStorage)

    const getItemSpy = vi.spyOn(Storage.prototype, "getItem").mockImplementation((key) => mockStorage.getItem(key))

    const doc: FbdDocument = {
      $schema: "../../fbd_v1.schema.json",
      schemaVersion: 1,
      profileId: "revA-1t-1-5-30",
      graphId: "graph-id-1",
      name: "SFE_TEST",
      layout: {
        schemaVersion: 1,
        nodes: {
          "c0000000-0000-4000-8000-000000000001": { x: 50, y: 50 },
          "c0000000-0000-4000-8000-000000000002": { x: 600, y: 50 }
        }
      },
      networks: [
        {
          id: "b0000000-0000-4000-8000-000000000000",
          name: "NW1",
          order: 0,
          nodes: [
            {
              id: "c0000000-0000-4000-8000-000000000001",
              kind: "INPUT",
              typeRef: "BOOL",
              executionOrder: 0,
              parameters: { variable: "IN_VAR" },
              ports: [{ id: "d0000000-0000-4000-8000-000000000001", name: "OUT", direction: "OUTPUT", dataType: "BOOL", unit: null, order: 0 }]
            },
            {
              id: "c0000000-0000-4000-8000-000000000002",
              kind: "OUTPUT",
              typeRef: "BOOL",
              executionOrder: 1,
              parameters: { variable: "OUT_VAR" },
              ports: [{ id: "d0000000-0000-4000-8000-000000000002", name: "IN", direction: "INPUT", dataType: "BOOL", unit: null, order: 0 }]
            }
          ],
          wires: [
            {
              id: wireId,
              from: { nodeId: "c0000000-0000-4000-8000-000000000001", portId: "d0000000-0000-4000-8000-000000000001" },
              to: { nodeId: "c0000000-0000-4000-8000-000000000002", portId: "d0000000-0000-4000-8000-000000000002" }
            }
          ]
        }
      ]
    }

    render(
      <I18nProvider>
        <StructuredFbdEditor
          document={doc}
          canEdit={true}
          onChange={vi.fn()}
          projectId="proj-test"
          objectId="pou-obj-1"
        />
      </I18nProvider>
    )

    // Stub xuất hiện trên canvas với tên tín hiệu đã nạp từ storage
    expect(screen.getByTestId("fbd-source-stub-d0000000-0000-4000-8000-000000000001")).toHaveTextContent("MOUNT_LOADED_SIG")

    getItemSpy.mockRestore()
  })

})
