# Hợp đồng OpenAPI

`openapi.yaml` là nguồn thẩm quyền duy nhất cho REST/WS công khai.

## Programming Rev A

Nhóm `/api/v1/programming` được khai báo trong `openapi.yaml` từ phiên bản
`1.15.0`. Go router và TypeScript client phải cùng dùng danh sách 25 operation
trong contract này; không thêm route riêng ở FE hoặc BE.

Sinh và kiểm client FE:

```bash
cd apps/web-ui
npm run generate:programming-api
npm run check:programming-api
```

`npm run build` tự chạy phép kiểm đồng bộ. Generator ghi vào
`apps/web-ui/src/features/programming/api/generated/client.ts`; tệp sinh ra
không được sửa bằng tay.

Route BE chỉ được mount khi `PROGRAMMING_REV_A=true`. Flag mặc định `OFF`; lúc
`OFF`, prefix Programming trả `404`. Trong `TASK-PROG-100`, khi flag `ON`, route
chỉ kiểm RBAC/header/body/version rồi trả lỗi ổn định `503
PRG-ERR-UNAVAILABLE-001`; chưa gọi Core và chưa tạo side effect Commission.
