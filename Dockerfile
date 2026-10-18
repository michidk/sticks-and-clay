# syntax=docker/dockerfile:1
FROM oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895 AS bun
FROM node:26-bookworm-slim@sha256:86f07bc9c5dce4578cf37e5a418b7bfc7f817cda25cde66e2b66e95ed86c4567

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl xz-utils python3 python3-venv \
    libsm6 libxext6 libxrender1 libxi6 libxfixes3 libxkbcommon0 \
    libgl1 libegl1 libgomp1 libglib2.0-0 fontconfig fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*
ARG BLENDER_VERSION=4.5.4
ARG BLENDER_SHA256=2e6ef8e99fc36327270429ddc8e7bad2859dd878a5a137d2e0bf0f02f6792505
RUN curl --fail --location --retry 3 \
    "https://download.blender.org/release/Blender4.5/blender-${BLENDER_VERSION}-linux-x64.tar.xz" \
    -o /tmp/blender.tar.xz \
    && echo "${BLENDER_SHA256}  /tmp/blender.tar.xz" | sha256sum --check \
    && mkdir /opt/blender \
    && tar -xJf /tmp/blender.tar.xz -C /opt/blender --strip-components=1 \
    && rm /tmp/blender.tar.xz \
    && /opt/blender/blender --background --version

# Keep persisted Blender scripts and Eve checkpoints at their original paths.
WORKDIR /home/vibepod/workspaces/sticks-and-clay
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY blender/requirements.txt ./blender/requirements.txt
COPY blender/materials/requirements.txt ./blender/materials/requirements.txt
COPY cad/requirements.txt ./cad/requirements.txt
RUN python3 -m venv .venv \
    && .venv/bin/pip install --no-cache-dir -r blender/requirements.txt
RUN python3 -m venv .venv-cad \
    && .venv-cad/bin/pip install --no-cache-dir -r cad/requirements.txt
COPY . .
RUN test ! -e .env && test ! -e eve/.eve && test ! -e eve/.output \
    && bun run build \
    && mkdir -p data eve/.eve \
    && chown -R node:node data eve
ENV NODE_ENV=production \
    PORT=3000 \
    BLENDER_BIN=/opt/blender/blender
USER node
EXPOSE 3000
CMD ["bash", "scripts/services.sh", "--production"]
