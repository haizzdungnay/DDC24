# Firmware

`stm32` sở hữu sampling, actuation, IOP reply, communication watchdog và safe
behavior độc lập. Firmware chỉ phụ thuộc `contracts/iop` và code nội bộ; không
phụ thuộc SHM, Linux service, Web hoặc HMI.
