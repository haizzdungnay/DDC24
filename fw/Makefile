CC = arm-none-eabi-gcc
CFLAGS = -mcpu=cortex-m0plus -mthumb -Wall -Wextra -Werror -O2 --specs=nosys.specs \
         -I. -Isrc/iop -I../shared

SRCS = Core/Src/main.c src/iop/iop_link.c
OBJS = $(SRCS:.c=.o)
TARGET = build/firmware.elf

all: $(TARGET)

$(TARGET): $(OBJS)
	mkdir -p build
	$(CC) $(CFLAGS) -o $@ $^

clean:
	rm -rf build $(OBJS)
