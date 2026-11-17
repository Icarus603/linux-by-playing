# 在獨立階段編譯 llama.cpp，只取出需要的執行檔。單獨使用時用來評測模型。
FROM ubuntu:24.04 AS build
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends build-essential cmake git ca-certificates curl libcurl4-openssl-dev \
 && rm -rf /var/lib/apt/lists/*
ARG LLAMA_REF=master
RUN git clone --depth 1 --branch ${LLAMA_REF} https://github.com/ggml-org/llama.cpp /src 2>&1 | tail -2 || git clone --depth 1 https://github.com/ggml-org/llama.cpp /src
WORKDIR /src
# GGML_NATIVE=OFF：不針對編譯機的 CPU 最佳化，讓映像檔能在不同機器上跑；GGML_CPU_ALL_VARIANTS 會在執行期自動挑最適合的 CPU 核心實作
RUN cmake -B build -DCMAKE_BUILD_TYPE=Release -DGGML_NATIVE=OFF -DBUILD_SHARED_LIBS=OFF -DLLAMA_CURL=OFF -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF \
 && cmake --build build -j"$(nproc)" --target llama-server llama-bench llama-cli 2>&1 | tail -5
RUN mkdir -p /out && cp build/bin/llama-server build/bin/llama-bench build/bin/llama-cli /out/ && ls -la /out && /out/llama-server --version 2>&1 | head -3

FROM scratch AS artifacts
COPY --from=build /out /
