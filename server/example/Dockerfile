# syntax=docker/dockerfile:1

# A game's server image: the engine's server package installed from its tarball, the game's
# settings beside it, and nothing else. No TypeScript is compiled here; the package ships
# compiled. The build context is a folder holding package.json (which depends on the tarball),
# package-lock.json and game.json; with a `file:` dependency, as in this example's package.json,
# it holds the tarball too (`*.tgz`). Build with:  docker build -t my-game-server .
# Where package.json names the release address instead, no tarball is needed.

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# The commit the image was built from, for the telemetry rows the process writes. An argument
# rather than a value set on the service: the service's environment belongs to whatever
# provisions it, and a value a deploy script set there would be a diff on every plan.
ARG BUILD_SHA=unknown
ENV BUILD_SHA=$BUILD_SHA
COPY package.json package-lock.json *.tgz ./
RUN npm ci --omit=dev
# Which game this server serves: the server reads `server/game.json` under its working
# directory (or the file GAME_SETTINGS names).
COPY game.json ./server/game.json
# A game with an admin page keeps its saved telemetry queries in the context too, and says
# where in its game.json (`"queries": "../queries"` for this line). A game without one needs
# neither.
# COPY queries ./queries
USER node
# Cloud Run injects PORT; 8080 is the default the server already falls back to.
ENV PORT=8080
CMD ["node", "node_modules/@csarkosh/engine-server/dist/index.js"]
