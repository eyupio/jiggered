# syntax=docker/dockerfile:1
FROM golang:1.26-alpine AS build
ARG VERSION=dev
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X main.version=${VERSION}" -o /out/jiggered . \
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
