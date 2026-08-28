/**
 * Annunciation cảnh báo — `T57-1.5`, đề xuất §6.3-P1a, thi hành `ADR-034`.
 *
 * ISA-18.2 coi annunciation là chức năng cốt lõi của một hệ alarm. Hôm nay một
 * cảnh báo Critical mới xuất hiện trên màn hình treo tường **không tạo bất kỳ
 * tín hiệu thu hút chú ý nào**; badge đếm là dấu hiệu duy nhất, và badge đếm
 * chỉ đọc được khi người ta đã nhìn vào đó.
 *
 * ## Vì sao lớp nghe phải tự khai báo trạng thái thật
 *
 * Trình duyệt **chặn phát âm khi chưa có tương tác người dùng**: `AudioContext`
 * sinh ra ở trạng thái `suspended` và mọi lời gọi phát âm bị từ chối. Đây là
 * chính sách nền tảng, không vòng qua được.
 *
 * Điều làm nó thành vấn đề an toàn: thiết bị này chạy trên màn hình treo tường
 * có thể đứng nhiều ngày không ai chạm vào. Sau một lần mất điện chớp nhoáng
 * hay một lần trình duyệt khởi động lại, trang tự nạp lại mà KHÔNG có cử chỉ
 * nào — nghĩa là kênh âm thanh chết im lặng đúng vào lúc không có ai ở đó để
 * phát hiện.
 *
 * Vì vậy `ADR-034` điều 3: giao diện phải hiện đủ **ba** trạng thái, và **cấm**
 * hiển thị "đã bật" khi ngữ cảnh âm thanh đang `suspended`. Khẳng định hệ thống
 * sẽ kêu, trong khi nó không thể kêu, tệ hơn hẳn việc không hứa gì.
 *
 * ## Vì sao tổng hợp âm thay vì nhúng tệp
 *
 * `OscillatorNode` + `GainNode` là vài dòng và không tốn byte nào của gói. Gói
 * Foxlinx hiện đã ~899 kB và bo không có đường ra Internet để tải tài nguyên
 * ngoài, nên một tệp `.mp3`/`.wav` nhúng là chi phí thật cho không thêm giá trị.
 */

export type AlarmSoundState = 'off' | 'armed' | 'blocked'

/** Khoá lưu tuỳ chọn, có namespace theo (thiết bị, tài khoản) — đúng khuôn
 *  `workspaceKey()` mà Landing đã dùng cho ghim (PA3-D04). Một kỹ thuật viên mở
 *  nhiều bo từ cùng một laptop, và một bo có nhiều tài khoản. */
export function alarmSoundKey(controller: string, username: string): string {
  return `mkddc:v1:alarm-sound:${controller || 'unknown'}:${username || 'anon'}`
}

export function readAlarmSoundPreference(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === 'on'
  } catch {
    return false
  }
}

export function writeAlarmSoundPreference(key: string, enabled: boolean): void {
  try {
    window.localStorage.setItem(key, enabled ? 'on' : 'off')
  } catch {
    /* localStorage bị khoá (chế độ riêng tư). Tuỳ chọn chỉ mất tính bền; trạng
       thái trong phiên vẫn đúng, và `resolveAlarmSoundState` vẫn nói thật. */
  }
}

/**
 * Trạng thái THẬT của kênh âm thanh — `ADR-034` điều 3.
 *
 * `contextState` là `AudioContext.state`, hoặc `undefined` khi chưa từng tạo
 * ngữ cảnh nào (người dùng chưa bật lần nào trong phiên này).
 *
 * Luật: đã bật mà ngữ cảnh **không** `running` ⇒ `blocked`. Không có ngoại lệ,
 * kể cả khi ta "khá chắc" là nó sẽ chạy được.
 */
export function resolveAlarmSoundState(enabled: boolean, contextState: AudioContextState | undefined): AlarmSoundState {
  if (!enabled) return 'off'
  return contextState === 'running' ? 'armed' : 'blocked'
}

/**
 * Có nên phát/nhấp nháy cho lần thay đổi này không.
 *
 * Chỉ kích hoạt khi số cảnh báo chưa xác nhận **TĂNG**. Kích hoạt theo "đang có
 * unack > 0" sẽ làm còi kêu liên tục suốt ca trực cho tới khi ack hết — đó là
 * cách chắc chắn nhất để người trực tắt tiếng vĩnh viễn, tức là mất hẳn lớp
 * annunciation (ISA-18.2 gọi đây là một dạng alarm fatigue).
 *
 * `previous < 0` nghĩa là chưa có lần đo nào: lần render ĐẦU TIÊN sau khi mở
 * trang không được coi là "cảnh báo mới". Nếu không, mở trang lúc đang có 5
 * cảnh báo cũ sẽ hú lên như thể vừa có sự cố.
 */
export function shouldAnnunciate(previousUnacked: number, currentUnacked: number): boolean {
  if (previousUnacked < 0) return false
  return currentUnacked > previousUnacked
}

/** Người dùng đã khai báo muốn giảm chuyển động chưa.
 *
 *  `matchMedia` không tồn tại trong một số môi trường test/nhúng cũ, nên phải
 *  kiểm trước khi gọi — ném ở đây sẽ làm hỏng cả AppShell. */
export function prefersReducedMotion(): boolean {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/**
 * Bộ phát tông cảnh báo.
 *
 * Trả về `AudioContext` để nơi gọi đọc được `state` thật. Không nuốt lỗi thành
 * `void`: nơi gọi phải biết ngữ cảnh có `running` hay không để hiện đúng trạng
 * thái ở điều 3.
 */
export class AlarmTone {
  private context: AudioContext | null = null

  get state(): AudioContextState | undefined {
    return this.context?.state
  }

  /** Tạo hoặc đánh thức ngữ cảnh. PHẢI được gọi từ trong một trình xử lý sự
   *  kiện do người dùng kích hoạt, nếu không `resume()` sẽ không được chấp nhận. */
  async arm(): Promise<AudioContextState | undefined> {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return undefined
    if (!this.context) this.context = new Ctor()
    try {
      if (this.context.state !== 'running') await this.context.resume()
    } catch {
      /* Trình duyệt từ chối — giữ nguyên `state`, nơi gọi sẽ hiện `blocked`. */
    }
    return this.context.state
  }

  /** Phát hai tiếng bíp ngắn. Không làm gì nếu ngữ cảnh chưa `running` — và
   *  đó chính là lý do `state` được phơi ra thay vì im lặng bỏ qua. */
  play(): void {
    const context = this.context
    if (!context || context.state !== 'running') return
    const now = context.currentTime
    for (const offset of [0, 0.28]) {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'square'
      oscillator.frequency.value = 880
      /* Bao biên độ có dốc lên/xuống: một sóng vuông bật/tắt đột ngột tạo tiếng
         "cạch" chói ở loa rẻ tiền của tủ điều khiển. */
      gain.gain.setValueAtTime(0.0001, now + offset)
      gain.gain.exponentialRampToValueAtTime(0.2, now + offset + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.2)
      oscillator.connect(gain).connect(context.destination)
      oscillator.start(now + offset)
      oscillator.stop(now + offset + 0.22)
    }
  }

  close(): void {
    void this.context?.close()
    this.context = null
  }
}
