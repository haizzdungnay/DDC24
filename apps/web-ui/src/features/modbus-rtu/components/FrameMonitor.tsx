import { useEffect, useState } from 'react'
import { apiClient } from '../../../shared/api/client'
import { useI18n } from '../../../shared/i18n'
import type { ModbusFramesResponse } from '../../../shared/types'
import { buttonClass } from '../shared'

/**
 * Xem khung truyền Modbus RTU — `T57-3.9` (`ADR-046` bản sửa 2026-08-19).
 *
 * BA CÂU HỎI HIỆN TRƯỜNG MÀ KHỐI NÀY TỒN TẠI ĐỂ TRẢ LỜI
 *
 *  · Khung có ra dây không?  → có bản ghi; `attempt` > 1 nghĩa là đã phát lại.
 *  · Slave có trả lời không? → cột kết quả.
 *  · CRC đúng không?         → lý do `crc`.
 *
 * HAI ĐIỀU PHẢI NÓI RA, KHÔNG ĐƯỢC ĐỂ NGƯỜI ĐỌC TỰ SUY
 *
 * 1. **Không có byte thô.** `ADR-046` bản đầu hứa hex dump; libmodbus không lộ
 *    bộ đệm wire nên Rev A ghi bản ghi giao dịch. Ai cần soi lỗi đóng khung ở
 *    tầng byte vẫn phải dùng máy phân tích bus — nói trước để không ai chờ đợi
 *    một thứ màn hình này không có.
 * 2. **Mất khi iobus khởi động lại.** Đây là công cụ chẩn đoán tại chỗ, không
 *    phải nhật ký lưu trữ.
 *
 * Khối này CHỈ ĐỌC. Nó không phát gì ra bus — đó là ranh giới tách nó khỏi chức
 * năng quét thiết bị (`T57-3.8`), thứ đang hoãn sang Rev B vì quét là ghi ra
 * RS-485 thật.
 */
export function FrameMonitor({ bus = 0 }: { bus?: number }) {
  const { pick } = useI18n()
  const [data, setData] = useState<ModbusFramesResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [live, setLive] = useState(false)
  const [loading, setLoading] = useState(false)

  async function load() {
    setLoading(true)
    try {
      setData(await apiClient.getModbusFrames(bus, 200))
      setError(null)
    } catch (err) {
      /* Lỗi KHÔNG được nuốt thành mảng rỗng: mảng rỗng đọc thành "bus im lặng",
         còn lỗi nghĩa là "không biết". Hai tình trạng đó dẫn tới hai kết luận
         trái ngược khi người kỹ thuật đang đứng trước tủ. */
      setData(null)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    if (!live) return undefined
    const timer = window.setInterval(() => { void load() }, 2000)
    return () => window.clearInterval(timer)
    /* Chủ ý chỉ phụ thuộc `bus` và `live`: `load` được dựng lại mỗi render, đưa
       nó vào deps sẽ tạo lại interval liên tục và biến "2 giây một lần" thành
       một vòng poll không kiểm soát. */
  }, [bus, live])

  return (
    <section className="rounded-[var(--radius)] border border-[var(--c-border)] p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-[var(--c-text)]">{pick('Khung truyền gần nhất', 'Recent transactions')}</h3>
          <p className="text-xs text-[var(--c-text-dim)]">
            {pick(
              'Ghi lại giao dịch mà chu kỳ quét bình thường đã thực hiện — màn hình này không tự phát gì ra bus.',
              'Records transactions the normal poll cycle already made — this screen sends nothing to the bus.'
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <button className={buttonClass} type="button" onClick={() => { void load() }} disabled={loading}>
            {pick('Tải lại', 'Reload')}
          </button>
          <button className={buttonClass} type="button" onClick={() => setLive((value) => !value)}>
            {live ? pick('Dừng theo dõi', 'Stop live') : pick('Theo dõi liên tục', 'Live')}
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="mb-2 rounded-[var(--radius)] border border-[var(--c-warn)] bg-[var(--c-warn-bg)] px-3 py-2 text-xs text-[var(--c-warn-fg)]">
          {error}
        </p>
      )}

      {data && (
        <>
          <p className="mb-2 text-xs text-[var(--c-text-dim)]">
            {pick(
              'Vòng nhớ nằm trong tiến trình iobus: mất khi dịch vụ khởi động lại, và không có byte thô — cần soi từng byte thì phải dùng máy phân tích bus.',
              'The ring lives inside the iobus process: it is cleared on restart, and holds no raw bytes — byte-level analysis needs a bus analyser.'
            )}
          </p>
          {data.frames.length === 0
            ? (
              <p className="text-sm text-[var(--c-text-dim)]">
                {pick('Chưa có giao dịch nào được ghi. Bus chưa có slave nào được poll, hoặc iobus vừa khởi động lại.', 'No transactions recorded yet. Either no slave is being polled, or iobus restarted.')}
              </p>
            )
            : (
              <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--c-border)]">
                <table className="w-full min-w-[720px] border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[var(--c-border)] bg-[var(--c-surface-2)] text-left uppercase text-[var(--c-text-dim)]">
                      <th className="px-2 py-1">{pick('Thời điểm', 'Time')}</th>
                      <th className="px-2 py-1">Bus</th>
                      <th className="px-2 py-1">Slave</th>
                      <th className="px-2 py-1">FC</th>
                      <th className="px-2 py-1">{pick('Địa chỉ', 'Address')}</th>
                      <th className="px-2 py-1">{pick('Số lượng', 'Count')}</th>
                      <th className="px-2 py-1">{pick('Kết quả', 'Result')}</th>
                      <th className="px-2 py-1">{pick('Thời lượng', 'Elapsed')}</th>
                      <th className="px-2 py-1">{pick('Lần phát', 'Attempt')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.frames.map((frame, index) => (
                      <tr key={`${frame.at}-${frame.bus}-${frame.slave}-${index}`} className="border-b border-[var(--c-border)]">
                        <td className="px-2 py-1 font-mono">{new Date(frame.at).toLocaleTimeString('vi-VN', { hour12: false })}</td>
                        <td className="px-2 py-1 font-mono">{frame.bus}</td>
                        <td className="px-2 py-1 font-mono">{frame.slave}</td>
                        <td className="px-2 py-1 font-mono">{frame.fc}</td>
                        <td className="px-2 py-1 font-mono">{frame.addr}</td>
                        <td className="px-2 py-1 font-mono">{frame.count}</td>
                        <td
                          className="px-2 py-1 font-semibold"
                          style={{ color: frame.ok ? 'var(--c-good-fg)' : 'var(--c-fault-fg)' }}
                        >
                          {frame.ok ? 'OK' : frame.reason.toUpperCase()}
                        </td>
                        <td className="px-2 py-1 font-mono">{(frame.elapsedUs / 1000).toFixed(1)} ms</td>
                        {/* Phát lại là DỮ LIỆU chẩn đoán, không phải nhiễu: một
                            bus phải phát lại liên tục là bus sắp hỏng. */}
                        <td className="px-2 py-1 font-mono" style={frame.attempt > 1 ? { color: 'var(--c-warn-fg)' } : undefined}>
                          {frame.attempt}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </>
      )}
    </section>
  )
}
