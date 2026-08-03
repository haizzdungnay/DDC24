CC = arm-none-eabi-gcc
MKDDC_VERSION ?= 0.1.0
REPO_ROOT := $(abspath ../..)
GIT_COMMIT := $(shell git -C $(REPO_ROOT) rev-parse HEAD 2>/dev/null || echo unknown)
ifneq ($(strip $(shell git -C $(REPO_ROOT) status --porcelain --untracked-files=normal 2>/dev/null)),)
GIT_COMMIT := $(GIT_COMMIT)-dirty
endif
BUILD_TIME := $(shell date -u +%Y-%m-%dT%H:%M:%SZ)
TOOLCHAIN := $(shell $(CC) -dumpfullversion 2>/dev/null || $(CC) -dumpversion)
CFLAGS = -mcpu=cortex-m0plus -mthumb -Wall -Wextra -Werror -O2 --specs=nosys.specs \
         -I. -Isrc/iop -Isrc/app -I../../contracts/iop -I../../contracts/config \
         -DMKDDC_BUILD_VERSION='"$(MKDDC_VERSION)"' \
         -DMKDDC_GIT_COMMIT='"$(GIT_COMMIT)"' \
         -DMKDDC_BUILD_TIME='"$(BUILD_TIME)"' \
         -DMKDDC_TOOLCHAIN='"arm-none-eabi-gcc-$(TOOLCHAIN)"'

SRCS = Core/Src/main.c src/iop/iop_link.c src/app/ddc24_runtime.c
BUILD_DIR ?= ../../build/firmware/stm32
OBJS = $(patsubst %.c,$(BUILD_DIR)/%.o,$(SRCS))
TARGET = $(BUILD_DIR)/firmware.elf

all: $(TARGET)

$(TARGET): $(OBJS)
	mkdir -p $(dir $@)
	$(CC) $(CFLAGS) -o $@ $^

$(BUILD_DIR)/%.o: %.c
	mkdir -p $(dir $@)
	$(CC) $(CFLAGS) -c -o $@ $<

clean:
	rm -rf $(BUILD_DIR)
