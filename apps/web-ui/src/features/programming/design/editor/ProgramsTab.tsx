/**
 * Facade tương thích của PGM-02.
 *
 * Implementation lớn đã được tách sang `EditorPane`; layout/resize nằm trong
 * `ProgramsWorkspace`, còn thư viện nằm trong `QuickLibraryPanel`. Giữ file
 * này làm entry point ổn định để không tạo một đợt đổi import không liên quan.
 */
export { EditorPane as ProgramsTab } from './EditorPane'
export * from './EditorPane'
