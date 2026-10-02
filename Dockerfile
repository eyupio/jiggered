# syntax=docker/dockerfile:1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e
# The build always runs on the builder's own CPU and cross-compiles (pure Go, no cgo), so a multi-platform image
# never has to run the compiler under emulation. That used to be most of the build time.
FROM --platform=$BUILDPLATFORM golang:1.27.1-alpine@sha256:8a5910f31396cd4d89662f56c68b3ae31d374308270a1c3bd96672ee5ed43414 AS build
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

FROM gcr.io/distroless/static-debian12:nonroot@sha256:afa5c872c891853ca7fcf1f12c3edb23f7eeef36189728842dd51042ff57f7ab
COPY --from=build /out/jiggered /jiggered
COPY --from=build --chown=nonroot:nonroot /out/data /data
USER nonroot
EXPOSE 8080
VOLUME ["/data"]
# No shell or curl in this image, so the binary checks itself.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD ["/jiggered", "healthcheck"]
ENTRYPOINT ["/jiggered"]

