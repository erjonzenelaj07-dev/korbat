FROM node:24-alpine AS build
RUN npm install -g pnpm@10.30.0
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages ./packages
COPY apps/worker ./apps/worker
RUN pnpm install --frozen-lockfile --filter @korbat/worker...
RUN pnpm --filter @korbat/worker build

FROM node:24-alpine
ENV NODE_ENV=production
# libvips reads this when it loads, so it has to be in the environment before the process starts.
ENV VIPS_BLOCK_UNTRUSTED=1
WORKDIR /app
COPY --from=build /repo/apps/worker/dist ./dist
# sharp is not bundled (native module). The install above ran on Alpine, so @img holds exactly the
# musl binaries for this image's CPU architecture. detect-libc and semver are what sharp itself needs.
COPY --from=build /repo/node_modules/sharp ./node_modules/sharp
COPY --from=build /repo/node_modules/@img ./node_modules/@img
COPY --from=build /repo/node_modules/detect-libc ./node_modules/detect-libc
COPY --from=build /repo/node_modules/semver ./node_modules/semver
# The volumes mount here. A new volume takes the owner of the path in the image, so both paths
# exist and belong to the user the process runs as, in this image and in the API's.
RUN mkdir -p /media/uploads /media/store && chown node:node /media/uploads /media/store
USER node
CMD ["node", "dist/index.js"]
