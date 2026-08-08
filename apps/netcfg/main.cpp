#include "netcfg.hpp"

#include <csignal>
#include <cstdio>
#include <memory>
#include <string>
#include <thread>

#include <pthread.h>
#include "build_info.h"

int main(int argc, char** argv)
{
    std::string socket_path = "/run/mkddc-netcfg/netcfg.sock";
    std::string journal_path = "/data/mkddc/netcfg-transaction.json";
    std::string allowed_user = "mkddc";
    std::string interface;
    for (int i = 1; i < argc; ++i) {
        const std::string arg = argv[i];
        if (arg == "--version") { std::printf("version=%s git_commit=%s build_time=%s toolchain=%s\n", MKDDC_BUILD_VERSION, MKDDC_GIT_COMMIT, MKDDC_BUILD_TIME, MKDDC_TOOLCHAIN); return 0; }
        else if (arg == "--socket" && i + 1 < argc) socket_path = argv[++i];
        else if (arg == "--journal" && i + 1 < argc) journal_path = argv[++i];
        else if (arg == "--allowed-user" && i + 1 < argc) allowed_user = argv[++i];
        else if (arg == "--interface" && i + 1 < argc) interface = argv[++i];
        else if (arg == "--help") {
            std::printf("usage: mkddc-netcfg [--socket PATH] [--journal PATH] "
                        "[--allowed-user USER] [--interface IFACE]\n");
            return 0;
        } else {
            std::fprintf(stderr, "ERROR netcfg.start unknown_argument=%s\n", arg.c_str());
            return 2;
        }
    }

    sigset_t signals;
    sigemptyset(&signals);
    sigaddset(&signals, SIGTERM);
    sigaddset(&signals, SIGINT);
    if (pthread_sigmask(SIG_BLOCK, &signals, nullptr) != 0) return 1;

    /* Chốt tên interface một lần, TRƯỚC khi dựng Engine.
     *
     * Engine dùng tên này làm phạm vi cho phép của giao dịch (`INTERFACE_NOT_ALLOWED`),
     * nên việc giải tên không thể để trong `status()`: nếu status trả `eth0` mà
     * Engine vẫn giữ `end1` thì candidate do giao diện dựng ra sẽ bị chính
     * authority từ chối.
     *
     * Vì sao cần giải tên: `NETCFG_INTERFACE` mặc định là `end1` (tên trên Orange
     * Pi 5B). Bo Foxlinx OK1126B đặt tên Ethernet là `eth0`, nên bản cài mặc định
     * trỏ vào một interface KHÔNG tồn tại — `active.reasonCode=INTERFACE_NOT_FOUND`,
     * không có địa chỉ, mode unknown, và cả trang mạng chết mà không có dấu hiệu
     * nào cho thấy nguyên nhân chỉ là một cái tên. */
    const std::string requested_interface = interface;
    interface = netcfg::resolve_ethernet_interface(interface, netcfg::list_wired_interfaces());
    if (interface != requested_interface)
        std::fprintf(stderr, "WARN  netcfg.start interface_not_found=%s resolved=%s\n",
                     requested_interface.c_str(), interface.c_str());
    else if (!interface.empty())
        std::fprintf(stderr, "INFO  netcfg.start interface=%s\n", interface.c_str());

    auto platform = std::make_shared<netcfg::LinuxPlatform>();
    netcfg::Engine engine(platform, journal_path, interface);
    netcfg::Server server(engine, socket_path, allowed_user);
    std::thread signal_thread([&] {
        int signal = 0;
        if (sigwait(&signals, &signal) == 0) server.stop();
    });
    const bool ok = server.run();
    server.stop();
    if (signal_thread.joinable()) pthread_kill(signal_thread.native_handle(), SIGTERM);
    if (signal_thread.joinable()) signal_thread.join();
    return ok ? 0 : 1;
}
