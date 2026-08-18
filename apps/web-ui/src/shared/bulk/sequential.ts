/**
 * Bộ chạy TUẦN TỰ dùng chung cho mọi thao tác hàng loạt của Web HMI.
 *
 * `T57-1.4` (ép tay hàng loạt) và `T57-1.6` (xác nhận cảnh báo hàng loạt) có
 * cùng một hình dạng bài toán, và cùng ba luật an toàn. Viết hai lần thì tới
 * lần thứ ba sẽ có hai cách xử lý huỷ hơi khác nhau — nghĩa là hai hành vi khác
 * nhau cho cùng một nút "Huỷ" trên hai màn hình.
 *
 * ## Ba luật
 *
 * 1. **Tuần tự, một request mỗi phần tử.** Backend không có API hàng loạt cho
 *    cả hai trường hợp (`PUT /points/{id}`, `POST /alarms/{id}/ack`). Gộp
 *    chúng ở giao diện rồi gọi là "một thao tác" là nói dối về thứ không thể
 *    nguyên tử — và hệ quả là **n vết kiểm toán**, đúng như yêu cầu vận hành.
 * 2. **Một phần tử hỏng KHÔNG làm dừng phần còn lại.** Dừng giữa chừng để lại
 *    một cụm nửa xử lý nửa không, tệ hơn hẳn so với chạy hết rồi báo đúng cái
 *    nào hỏng.
 * 3. **Huỷ dừng phần CHƯA gửi, và nói ra phần ĐÃ gửi.** Không tự động hoàn tác:
 *    hoàn tác cũng là một thao tác có thể hỏng y như thao tác gốc.
 */

export type SequentialStatus = 'sent' | 'failed' | 'skipped'

export interface SequentialItem {
  id: string
  /** Nhãn hiển thị, đi kèm kết quả để nơi gọi không phải tra ngược. */
  label: string
}

export interface SequentialOutcome {
  id: string
  label: string
  status: SequentialStatus
  /** Nguyên văn lỗi. Không diễn dịch lại thành câu chung chung. */
  message?: string
}

export interface SequentialOptions {
  /** Đọc LẠI trước mỗi phần tử — không phải một `boolean` chụp một lần, vì
   *  giá trị đóng băng tại lúc bắt đầu vòng lặp làm nút Huỷ vô nghĩa. */
  isAborted?: () => boolean
  onProgress?: (outcome: SequentialOutcome) => void
}

export async function runSequential<T extends SequentialItem>(
  items: T[],
  send: (item: T) => Promise<void>,
  options: SequentialOptions = {}
): Promise<SequentialOutcome[]> {
  const { isAborted, onProgress } = options
  const outcomes: SequentialOutcome[] = []
  let aborted = false

  for (const item of items) {
    if (!aborted && isAborted?.()) aborted = true

    if (aborted) {
      const outcome: SequentialOutcome = { id: item.id, label: item.label, status: 'skipped' }
      outcomes.push(outcome)
      onProgress?.(outcome)
      continue
    }

    let outcome: SequentialOutcome
    try {
      await send(item)
      outcome = { id: item.id, label: item.label, status: 'sent' }
    } catch (error) {
      /* Luật 2: KHÔNG `break`. */
      outcome = { id: item.id, label: item.label, status: 'failed', message: error instanceof Error ? error.message : String(error) }
    }
    outcomes.push(outcome)
    onProgress?.(outcome)
  }

  return outcomes
}

export function summarizeSequential(outcomes: SequentialOutcome[]): Record<SequentialStatus, number> {
  const summary: Record<SequentialStatus, number> = { sent: 0, failed: 0, skipped: 0 }
  for (const outcome of outcomes) summary[outcome.status] += 1
  return summary
}
