# syntax=docker/dockerfile:1
# The build always runs on the builder's own CPU and cross-compiles (pure Go, no cgo), so a multi-platform image
# never has to run the compiler under emulation. That used to be most of the build time.
FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS build
ARG VERSION=dev
ARG TARGETOS
ARG TARGETARCH
ENV CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
# Compile the dependencies (the SQLite library is the slow part) in a layer of their own. It only changes when
# go.mod does, so ordinary code changes reuse it from the build cache.
RUN go build -trimpath modernc.org/sqlite golang.org/x/crypto/bcrypt
COPY . .
RUN go build -trimpath -ldflags="-s -w -X main.version=${VERSION}" -o /out/jiggered . \
 && mkdir -p /out/data

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/jiggered /jiggered
COPY --from=build --chown=nonroot:nonroot /out/data /data
USER nonroot
EXPOSE 8080
VOLUME ["/data"]
# No shell or curl in this image, so the binary checks itself.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD ["/jiggered", "healthcheck"]
ENTRYPOINT ["/jiggered"]
