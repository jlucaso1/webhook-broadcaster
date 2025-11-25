FROM oven/bun AS build

WORKDIR /app

COPY ./index.ts ./index.ts

ENV NODE_ENV=production

RUN bun build \
	--compile \
	--minify-whitespace \
	--minify-syntax \
	--outfile server \
	index.ts

FROM gcr.io/distroless/base

WORKDIR /app

COPY --from=build /app/server server

ENV NODE_ENV=production
ENV NODE_TLS_REJECT_UNAUTHORIZED=0

CMD ["./server"]

EXPOSE 3000