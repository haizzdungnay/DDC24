#include "netcfg.hpp"

#include <csignal>
#include <cstdio>
#include <memory>
#include <string>
#include <thread>

#include <pthread.h>

int main(int argc, char** argv)
{
    std::string socket_path = "/run/mkddc/netcfg.sock";
    std::string journal_path = "/data/mkddc/netcfg-transaction.json";
    std::string allowed_user = "mkddc";
    std::string interface;
    for (int i = 1; i < argc; ++i) {
        const std::string arg = argv[i];
        if (arg == "--socket" && i + 1 < argc) socket_path = argv[++i];
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
