# Hợp đồng OpenAPI

`openapi.yaml` là nguồn thẩm quyền duy nhất cho REST/WS công khai.

## Programming Rev A

Nhóm `/api/v1/programming` được khai báo trong `openapi.yaml` từ phiên bản
`1.15.0`; bản `1.18.0` nối tám endpoint Project/Draft/Revision/Check và đồng bộ đủ 20 mã lỗi công khai từ
`contracts/programming/error_catalog_v1.json`. Go router và TypeScript client
phải cùng dùng danh sách 25 operation và cùng catalog lỗi; không thêm route hoặc
mã lỗi riêng ở FE/BE/Core.

Sinh và kiểm client FE:

```bash
cd apps/web-ui
npm run generate:programming-api
npm run generate:programming-errors
npm run check:programming-contracts
```

`npm run build` tự chạy phép kiểm đồng bộ. Hai generator ghi vào
`apps/web-ui/src/features/programming/api/generated/{client,errors}.ts`; tệp
sinh ra không được sửa bằng tay.

Route BE chỉ được mount khi `PROGRAMMING_REV_A=true`. Flag mặc định `OFF`; lúc
`OFF`, prefix Programming trả `404`. Trong `TASK-PROG-100`, khi flag `ON`, route
`TASK-PROG-204..205`, tám endpoint Project/Draft/Revision/Check dùng SQLite bền
vững cùng compiler worker sandbox; 17 route lifecycle
chưa tới task vẫn trả lỗi ổn định `503 PRG-ERR-UNAVAILABLE-001` và chưa gọi Core.
