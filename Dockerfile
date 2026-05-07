ARG NODE_IMAGE=node:20-bookworm-slim

FROM ${NODE_IMAGE} AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="${PNPM_HOME}:${PATH}"
ENV NEXT_TELEMETRY_DISABLED="1"

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.12.3 --activate

FROM base AS build

ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_BASE_URL="${NEXT_PUBLIC_API_BASE_URL}"

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm db:generate
RUN pnpm build

FROM base AS runtime

ENV NODE_ENV="production"
ENV NEXT_TELEMETRY_DISABLED="1"

WORKDIR /app

COPY --from=build /app /app

EXPOSE 3000 4000 4100 4200

CMD ["pnpm", "--filter", "@openkb/api", "start"]
