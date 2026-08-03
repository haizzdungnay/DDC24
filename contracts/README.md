# Hợp đồng dùng chung

Đây là nguồn thẩm quyền duy nhất cho các hợp đồng liên tiến trình và thiết bị:

- `iop/`: giao thức UART giữa SOM và STM32;
- `shm/`: layout shared memory giữa các tiến trình SOM;
- `config/`: build metadata và JSON Schema cho IPC/config;
- `openapi/`: hợp đồng REST/WS công khai.

Thư mục `shared/` chỉ còn shim tương thích có kiểm soát trong thời gian
migration. Code mới phải include hoặc tham chiếu trực tiếp `contracts/`.
