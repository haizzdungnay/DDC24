import { describe, expect, it } from 'vitest'
import corpus from '../../../../../../../contracts/programming/st_grammar_corpus_v1.json'
import { formatStDocument } from './stFormat'

/**
 * `ISS-STED-13` / `F-STED-011` — NỬA FE CỦA CORPUS VĂN PHẠM DÙNG CHUNG.
 *
 * FE có ba bộ đọc ST độc lập với compiler, và chỉ phần *từ khoá* có cơ chế
 * chống trôi. Tệp corpus là nguồn chung: `test_st_grammar_corpus.cpp` đòi
 * compiler phán quyết đúng như nó nói, tệp này đòi formatter cũng vậy.
 *
 * Vì sao formatter là phía FE được chọn để đối chiếu: trong ba bộ đọc, nó là
 * bộ duy nhất có một PARSER ĐẦY ĐỦ, tức bộ duy nhất có thể "hiểu" một cấu trúc
 * mà compiler không có. Bộ tô màu và chỉ mục ký hiệu chỉ nhận diện token, sai
 * của chúng dừng ở thẩm mỹ và điều hướng.
 *
 * Luật: **formatter không được chấp nhận thứ compiler từ chối.** Chấp nhận là
 * viết lại mã điều khiển theo một văn phạm mà thiết bị không nói.
 */

interface Vector {
  id: string
  rule: string
  accepted: boolean
  note: string
  source: string
  rejectedWith?: string
}

const vectors = corpus.vectors as Vector[]

describe('corpus văn phạm dùng chung — ISS-STED-13', () => {
  it('corpus có đủ hai chiều phán quyết', () => {
    // Corpus chỉ toàn ca được chấp nhận sẽ xanh cả khi formatter nuốt mọi thứ.
    expect(vectors.length).toBeGreaterThanOrEqual(10)
    expect(vectors.filter((vector) => vector.accepted).length).toBeGreaterThanOrEqual(5)
    expect(vectors.filter((vector) => !vector.accepted).length).toBeGreaterThanOrEqual(5)
  })

  it.each(vectors.filter((vector) => vector.accepted))(
    'trong subset: formatter định dạng được `$id`',
    (vector) => {
      const result = formatStDocument(vector.source)
      expect(result.ok, result.ok ? '' : `formatter từ chối: ${result.reason}`).toBe(true)
    },
  )

  it.each(vectors.filter((vector) => !vector.accepted))(
    'ngoài subset: formatter TỪ CHỐI `$id` — không viết lại thứ nó không hiểu',
    (vector) => {
      const result = formatStDocument(vector.source)
      expect(
        result.ok,
        `formatter chấp nhận một cấu trúc compiler từ chối (${vector.rejectedWith ?? 'ngoài subset'}). ` +
        'Đây đúng là chỗ trôi mà F-STED-011 nêu: FE hiểu một văn phạm rộng hơn thiết bị.',
      ).toBe(false)
    },
  )

  it('mỗi ca ngoài subset đều ghi mã lỗi thật của compiler', () => {
    // Mã trong corpus do phía C++ kiểm; ở đây chỉ khoá rằng nó KHÔNG bị bỏ
    // trống — một ca "ngoài subset" không nói được vì sao thì người đọc không
    // biết phải sửa gì.
    for (const vector of vectors.filter((item) => !item.accepted)) {
      expect(vector.rejectedWith, `vector ${vector.id} thiếu mã lỗi`).toMatch(/^ST-[A-Z]+-\d{3}$/)
    }
  })
})
