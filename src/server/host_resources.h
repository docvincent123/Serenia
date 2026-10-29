#pragma once
// Read-only host telemetry. It never exposes files, process arguments or secrets.
#include <cstdint>
#include <filesystem>
#if defined(__linux__)
#include <sys/sysinfo.h>
#endif

J hostResources() {
    J result={{"platform",
#if defined(__linux__)
        "linux"
#elif defined(_WIN32)
        "windows"
#else
        "other"
#endif
    },{"disk_available",false},{"memory_available",false}};
#if defined(__linux__)
    try {
        const auto space=std::filesystem::space("/var/lib/solvia");
        if(space.capacity>0 && space.available!=static_cast<std::uintmax_t>(-1)){
            result["disk_available"]=true;
            result["disk_total_bytes"]=space.capacity;
            result["disk_free_bytes"]=space.available;
            result["disk_used_percent"]=100.0*(space.capacity-space.available)/space.capacity;
        }
    } catch(const std::filesystem::filesystem_error&) {
        // Unknown is safer than a fabricated healthy disk metric.
    }
    struct sysinfo info{};
    if(::sysinfo(&info)==0){
        result["memory_available"]=true;
        result["memory_total_bytes"]=static_cast<std::uint64_t>(info.totalram)*info.mem_unit;
        result["memory_free_bytes"]=static_cast<std::uint64_t>(info.freeram)*info.mem_unit;
        result["uptime_seconds"]=info.uptime;
        result["load_1min"]=static_cast<double>(info.loads[0])/65536.0;
    }
#endif
    return result;
}
