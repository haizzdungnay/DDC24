# Apps

Mỗi thư mục con sở hữu đúng một process hoặc application deployment unit.
Dependency giữa app chỉ đi qua contract công khai/IPC; app không include hay
import source implementation của app khác. Bootstrap compose dependency và
quản lý lifecycle, không sở hữu policy domain.
