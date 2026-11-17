# syntax=docker/dockerfile:1
# 建置參數：WITH_LLM=1（預設）內建本機小模型讓 Pip 能回答自然語言問題；WITH_LLM=0 做精簡版（約少 1.5GB，只用離線知識庫）。
ARG WITH_LLM=1
# 預設內建 Qwen3.5-4B（Q4_K_M，約 2.6GB，Apache-2.0）。想要較小的版本可改用 2B：
#   --build-arg LLM_URL=https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q4_K_M.gguf \
#   --build-arg LLM_SHA256=aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223
ARG LLM_URL=https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf
ARG LLM_SHA256=00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4

# ---- 編譯 llama.cpp（WITH_LLM=0 時 BuildKit 會跳過這個階段）----
FROM ubuntu:24.04 AS llm-1
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends build-essential cmake git ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 https://github.com/ggml-org/llama.cpp /src
WORKDIR /src
# GGML_NATIVE=OFF：不針對編譯機的 CPU 最佳化，映像檔才能在不同機器上跑；
# GGML_CPU_ALL_VARIANTS 與動態後端會在執行期挑選最適合的 CPU 實作（例如 ARM 的 dotprod / i8mm）。
RUN cmake -B build -DCMAKE_BUILD_TYPE=Release -DGGML_NATIVE=OFF -DBUILD_SHARED_LIBS=OFF -DLLAMA_CURL=OFF \
      -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF \
 && cmake --build build -j"$(nproc)" --target llama-server \
 && mkdir -p /out && cp build/bin/llama-server /out/
# 下載模型並驗證雜湊（有提供 LLM_SHA256 時）。模型授權見 docs/MODELS.md。
ARG LLM_URL
ARG LLM_SHA256
RUN curl -fL --retry 3 --retry-delay 3 -o /out/model.gguf "$LLM_URL" \
 && if [ -n "$LLM_SHA256" ]; then echo "$LLM_SHA256  /out/model.gguf" | sha256sum -c -; fi
FROM ubuntu:24.04 AS llm-0
RUN mkdir -p /out
FROM llm-${WITH_LLM} AS llmbin

# ---- 建置：把引擎 + HUD 編成單一執行檔 ----
# ---- 參考資料：tldr-pages（CC BY 4.0）與 Linux 核心文件 v6.8（GPL-2.0），獨立階段以利快取 ----
FROM ubuntu:24.04 AS refs
RUN apt-get update && apt-get install -y --no-install-recommends curl unzip ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /refs
RUN curl -fsSL https://github.com/tldr-pages/tldr/releases/latest/download/tldr-pages.zip -o t.zip \
 && mkdir tldr && unzip -q t.zip -d tldr && rm t.zip
RUN mkdir kdoc && cd kdoc && B=https://raw.githubusercontent.com/torvalds/linux/v6.8/Documentation \
 && for f in networking/ip-sysctl.rst admin-guide/sysctl/vm.rst admin-guide/sysctl/fs.rst admin-guide/sysctl/kernel.rst admin-guide/sysctl/net.rst \
      admin-guide/cgroup-v2.rst admin-guide/kernel-parameters.txt admin-guide/mm/transhuge.rst admin-guide/perf-security.rst \
      filesystems/proc.rst filesystems/tmpfs.rst scheduler/sched-design-CFS.rst; do \
      curl -fsSL "$B/$f" -o "$(basename $f)" || echo "skip $f"; done

FROM oven/bun:1 AS build
WORKDIR /src
COPY package.json bun.lock ./
COPY vendor ./vendor
RUN bun install --frozen-lockfile
COPY src ./src
RUN bun build --compile --minify src/cli.ts --outfile /out/lbp

# ---- 執行：真實的 Ubuntu 環境 ----
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8 LC_ALL=C.UTF-8

# 先還原被最小化映像移除的 man page / 文件
RUN apt-get update && apt-get install -y --no-install-recommends unminimize \
 && yes | unminimize >/dev/null 2>&1 || true

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates sudo tmux less man-db manpages \
    vim nano tree file jq bc gawk sed grep findutils diffutils patch \
    procps psmisc lsof strace ltrace htop time \
    iproute2 iputils-ping traceroute dnsutils netcat-openbsd net-tools telnet \
    curl wget openssh-client openssh-server rsync tcpdump iptables openssl \
    cron at acl zip unzip bzip2 xz-utils gzip tar cpio \
    git make python3 xxd bsdextrautils plocate shellcheck libcap2-bin kmod \
    util-linux e2fsprogs logrotate binutils tini manpages-dev libgomp1 \
 && (mandb -q 2>/dev/null || true) \
 && rm -rf /var/lib/apt/lists/*

# 玩家帳號：一般使用者 + 免密 sudo（之後的關卡會教 sudo 與權限）
RUN (userdel -r ubuntu 2>/dev/null || true) \
 && useradd -m -s /bin/bash -u 1000 player \
 && echo 'player ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/player \
 && chmod 0440 /etc/sudoers.d/player

COPY --from=build /out/lbp /usr/local/bin/lbp
# 內建小模型與推論伺服器（WITH_LLM=0 時這個目錄是空的，遊戲會自動退回離線知識庫）
COPY --from=llmbin /out/ /game/llm/
COPY docker/player.bashrc /game/
COPY docker/entrypoint.sh /game/entrypoint.sh
COPY docker/lbp-systemctl /usr/local/bin/systemctl
COPY docker/lbp-journalctl /usr/local/bin/journalctl
COPY levels /game/levels
COPY world/ghost /var/lib/ghost
COPY knowledge /game/knowledge
COPY eval /game/eval
# 匯入 man page、tldr 範例與核心文件，作為 RAG 的長尾知識
RUN --mount=type=bind,from=refs,source=/refs,target=/refs lbp build-knowledge /game/knowledge/ref.json /refs
RUN printf '#!/bin/sh\nexec lbp answer "$@"\n' > /usr/local/bin/answer \
 && chmod +x /usr/local/bin/answer /game/entrypoint.sh /usr/local/bin/systemctl /usr/local/bin/journalctl

ENV LBP_SAVE=/save
VOLUME /save
WORKDIR /home/player
# tini 當 PID 1：回收被結束的子程序，否則 kill 掉的程序會變殭屍，pgrep 仍找得到它
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/game/entrypoint.sh"]
CMD ["lbp", "play"]
