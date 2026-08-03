include_guard(GLOBAL)

get_filename_component(MKDDC_REPOSITORY_ROOT
  "${CMAKE_CURRENT_LIST_DIR}/../.." ABSOLUTE)

# Path source chính thức sau G3. Consumer dùng target/binary ổn định và không
# hardcode layout nội bộ ngoài file authority này.
set(MKDDC_CORE_SOURCE_DIR
  "${MKDDC_REPOSITORY_ROOT}/apps/core")
set(MKDDC_IOBUS_SOURCE_DIR
  "${MKDDC_REPOSITORY_ROOT}/apps/iobus")
set(MKDDC_NETCFG_SOURCE_DIR
  "${MKDDC_REPOSITORY_ROOT}/apps/netcfg")
set(MKDDC_HMI_SOURCE_DIR
  "${MKDDC_REPOSITORY_ROOT}/apps/hmi")
set(MKDDC_FW_SOURCE_DIR
  "${MKDDC_REPOSITORY_ROOT}/firmware/stm32")
set(MKDDC_FW_HOSTCHECK_SOURCE_DIR
  "${MKDDC_FW_SOURCE_DIR}/hostcheck")
set(MKDDC_CONTRACTS_SOURCE_DIR
  "${MKDDC_REPOSITORY_ROOT}/contracts")
set(MKDDC_CONTRACT_IOP_DIR
  "${MKDDC_CONTRACTS_SOURCE_DIR}/iop")
set(MKDDC_CONTRACT_SHM_DIR
  "${MKDDC_CONTRACTS_SOURCE_DIR}/shm")
set(MKDDC_CONTRACT_CONFIG_DIR
  "${MKDDC_CONTRACTS_SOURCE_DIR}/config")
set(MKDDC_TOOLS_SOURCE_DIR
  "${MKDDC_REPOSITORY_ROOT}/tools")
set(MKDDC_CMAKE_MODULE_DIR
  "${MKDDC_REPOSITORY_ROOT}/platform/cmake")
