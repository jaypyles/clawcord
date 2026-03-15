# -----------------------------------------------------------------------------
# Stage 1: Dependencies (cached unless package.json / bun.lock change)
# -----------------------------------------------------------------------------
FROM oven/bun:1 AS deps
WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install

# -----------------------------------------------------------------------------
# Stage 2: Runtime image (Debian: bash, coreutils, python, pipx)
# -----------------------------------------------------------------------------
FROM oven/bun:1 AS runner
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
  bash \
  busybox \
  ca-certificates \
  curl \
  python3 \
  python3-pip \
  python3-venv \
  && pip3 install --break-system-packages pipx \
  && pipx ensurepath \
  && rm -rf /var/lib/apt/lists/*
ENV PIPX_HOME=/usr/local/pipx \
  PIPX_BIN_DIR=/usr/local/bin \
  PATH="/usr/local/bin:${PATH}"

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./

# Copy application source and agent-core (behavior, memory, schedule, etc.)
COPY src ./src
COPY tsconfig.json ./

ENTRYPOINT ["bun", "run", "start"]
