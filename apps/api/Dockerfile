FROM node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS build
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
# pnpm verifies the repository patches named in package.json at every install, hashed into the lockfile.
COPY patches ./patches
# pnpm at the version and hash the root package.json names; corepack verifies the download against the hash.
RUN corepack enable && corepack install
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm install --frozen-lockfile --filter @korbat/api...
RUN pnpm --filter @korbat/api build

FROM node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
ENV NODE_ENV=production
ARG KORBAT_VERSION=0.0.0
ENV KORBAT_VERSION=$KORBAT_VERSION
WORKDIR /app
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/packages/db/migrations ./migrations
# argon2 is not bundled (native module). The install above ran on Alpine, so @node-rs holds the
# package and exactly the musl binary for this image's CPU architecture.
COPY --from=build /repo/node_modules/@node-rs ./node_modules/@node-rs
# The media volumes mount here. A new volume takes the owner of the path in the image, so both paths
# exist and belong to the user the process runs as, in this image and in the worker's.
RUN mkdir -p /media/uploads /media/store && chown node:node /media/uploads /media/store
# 3b: the import volumes mount here, as in the importer's image, for the same reason: the API writes import-archives and
# reads import-work, which the importer writes, both as uid 1000.
RUN mkdir -p /import/archives /import/work && chown node:node /import/archives /import/work
# 3d: the quarantine's volume mounts here, in the one-shot services quarantine (read-write) and handover (read-only),
# never in the API's or the worker's. A new volume takes this path's owner and mode, so it is the image's user's alone
# (uid 1000, mode 0700): a path the image lacked would be root's, which the mover, with every capability dropped,
# could neither write nor repair.
RUN mkdir -p /media/quarantine && chown node:node /media/quarantine && chmod 0700 /media/quarantine
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
